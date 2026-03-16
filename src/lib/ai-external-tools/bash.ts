// External tool: bash
// Runs shell commands in a stateful in-process bash interpreter backed by
// a MountableFs: reads from allowedDir (via a read-only OverlayFs) and
// writes to ai_chat_temp_files/ (via a ReadWriteFs backed by real disk).

import { lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Bash, MountableFs, OverlayFs, ReadWriteFs } from "just-bash";
import {
    isDeniedPath,
    SandboxError,
    toForwardSlashes,
} from "../monty-sandbox-helpers";

/**
 * Wraps a filesystem instance with a deny-list gate on read operations.
 *
 * Creates a prototypical delegate via Object.create so that all filesystem
 * methods (including the sync variants used by initFilesystem such as
 * mkdirSync and writeFileSync) continue to work without being enumerated here.
 * Only readFile, readFileBuffer, and readdir are overridden to enforce
 * SENSITIVE_FILE_DENY_LIST, applying the same protection already present in
 * read_file() and ls(). When an inherited method (cp, chmod, utimes, …)
 * internally calls this.readFileBuffer, it calls the override — so the deny
 * list is enforced transitively for all read paths. MountableFs does not
 * expose readdirWithFileTypes; bash falls back to the filtered readdir()
 * automatically, which provides equivalent protection.
 *
 * @param fs - The filesystem instance to wrap (OverlayFs or MountableFs).
 * @param mountPoint - The virtual mount point (equals allowedDir); used to
 *   derive the relative path for deny-list matching.
 * @returns A filesystem-compatible wrapper that blocks reads of denied paths.
 */
function withDenyList<T extends object>(fs: T, mountPoint: string): T {
    // mountPrefix has a trailing slash so startsWith only matches genuine
    // children, not a sibling directory sharing the same prefix string.
    const mountPrefix = `${mountPoint}/`;

    /**
     * Throws EACCES if the virtual path matches a deny-list pattern.
     *
     * @param path - The virtual path being read.
     */
    const checkPath = (path: string): void => {
        if (!path.startsWith(mountPrefix)) return;
        const rel = toForwardSlashes(path.slice(mountPrefix.length));
        if (rel && isDeniedPath(rel)) {
            throw new Error(`EACCES: permission denied, open '${path}'`);
        }
    };

    /**
     * Returns true if a directory entry should be hidden from directory
     * listings. Matches the same deny list used for read operations so that
     * commands like ls and find cannot enumerate sensitive file names even
     * when reading their contents is blocked.
     *
     * DirPath may equal mountPoint exactly (no trailing slash) when listing
     * the root of the allowed directory, or start with mountPrefix when
     * listing a subdirectory — both cases must be handled..
     *
     * @param dirPath - The virtual path of the directory being listed.
     * @param name - The bare filename of the entry within that directory.
     * @returns True if the entry should be omitted from the listing.
     */
    const isHiddenEntry = (dirPath: string, name: string): boolean => {
        const isRoot = dirPath === mountPoint;
        const isChild = dirPath.startsWith(mountPrefix);
        if (!isRoot && !isChild) return false;
        const dirRel = isRoot
            ? ""
            : toForwardSlashes(dirPath.slice(mountPrefix.length));
        const entryRel = dirRel ? `${dirRel}/${name}` : name;
        return isDeniedPath(entryRel);
    };

    // Object.create(fs) produces an object whose prototype is the fs
    // instance. Property lookups fall through to fs for everything except the
    // methods defined directly on the wrapper below, preserving the full
    // filesystem surface (including mkdirSync/writeFileSync needed by Bash's
    // internal initFilesystem call).
    //
    // Both OverlayFs and MountableFs implement the same IFileSystem interface.
    // We cast internally to OverlayFs to get full type-safe method access; the
    // cast is safe because all required methods exist on both types.
    const fsTyped = fs as unknown as OverlayFs;
    const wrapper = Object.create(fs) as T;
    const wrapperTyped = wrapper as unknown as OverlayFs;

    /**
     * Deny-list-gated readFile: checks the path before delegating to the
     * underlying filesystem instance.
     *
     * @param path - Virtual path to read.
     * @param options - Encoding options forwarded to readFile.
     * @returns The file contents as a string.
     */
    wrapperTyped.readFile = async (
        path: string,
        options?: Parameters<OverlayFs["readFile"]>[1],
    ): Promise<string> => {
        checkPath(path);
        return fsTyped.readFile(path, options);
    };

    /**
     * Deny-list-gated readFileBuffer: checks the path before delegating to
     * the underlying filesystem instance.
     *
     * @param path - Virtual path to read.
     * @returns The file contents as a Uint8Array.
     */
    wrapperTyped.readFileBuffer = async (path: string): Promise<Uint8Array> => {
        checkPath(path);
        return fsTyped.readFileBuffer(path);
    };

    /**
     * Filtered readdir: removes entries whose names match the deny list so
     * that commands such as ls and find cannot enumerate sensitive file names.
     *
     * @param path - Virtual path of the directory to list.
     * @returns Names of non-denied directory entries.
     */
    wrapperTyped.readdir = async (path: string): Promise<string[]> => {
        const entries = await fsTyped.readdir(path);
        return entries.filter((name) => !isHiddenEntry(path, name));
    };

    // MountableFs does not expose readdirWithFileTypes, so bash falls back to
    // the filtered readdir() above, which provides the same deny-list
    // protection. No readdirWithFileTypes override is needed.

    return wrapper;
}

/**
 * Returns the bash tool implementation bound to the given context.
 *
 * Sets up a MountableFs composition:
 * - allowedDir → read-only OverlayFs base (LLM can read, never write)
 * - allowedDir/ai_chat_temp_files → ReadWriteFs mount (LLM writes persist to disk).
 *
 * If setup fails (unwritable directory, symlink at ai_chat_temp_files pointing
 * outside allowedDir, etc.) falls back to a writable in-memory OverlayFs so
 * bash remains functional with ephemeral writes.
 *
 * The filesystem is wrapped with the sensitive-file deny list so blocked
 * reads are enforced uniformly. Shell state (cwd, variables) does not
 * persist between calls; use compound commands for multi-step pipelines.
 *
 * @param allowedDir - The sandboxed root directory (also used as mount point).
 * @param signal - Optional abort signal; when fired, cancels the in-flight bash command.
 * @param maxMemory - Sandbox memory cap in bytes (from SandboxOptions). Used to
 *   derive memory-related bash limits (maxOutputSize, maxStringLength, maxHeredocSize)
 *   so that bash behaves consistently with the user-visible sandbox memory setting.
 * @param maxAllocations - Sandbox allocation cap (from SandboxOptions). Used to
 *   derive iteration-related bash limits (maxCommandCount, maxLoopIterations, etc.)
 *   so that bash behaves consistently with the user-visible sandbox allocation setting.
 * @returns An async function callable from Python that runs shell commands.
 */
export function makeBash(
    allowedDir: string,
    signal?: AbortSignal,
    maxMemory = 512 * 1024 * 1024,
    maxAllocations = 100_000,
): (command: string) => Promise<unknown> {
    // ai_chat_temp_files must exist on disk before ReadWriteFs is constructed
    // because ReadWriteFs calls realpathSync(root) in its constructor.
    const outputDir = join(allowedDir, "ai_chat_temp_files");
    mkdirSync(outputDir, { recursive: true });

    // Reject symlinks: ReadWriteFs resolves root to its canonical real path,
    // so a symlink pointing outside allowedDir would allow bash writes to
    // escape the sandbox boundary.
    if (lstatSync(outputDir).isSymbolicLink()) {
        throw new Error("ai_chat_temp_files must not be a symlink");
    }

    const overlayFs = new OverlayFs({
        root: allowedDir,
        mountPoint: allowedDir,
        readOnly: true,
    });

    const readWriteFs = new ReadWriteFs({ root: outputDir });

    // overlayFs is the base (not a mount) to bypass MountableFs's restriction
    // against nesting a mount inside another.
    const mountable = new MountableFs({ base: overlayFs });
    mountable.mount(outputDir, readWriteFs);

    const shell = new Bash({
        fs: withDenyList(mountable, allowedDir),
        cwd: allowedDir,
        // Execution limits derived from the sandbox-level memory and allocation
        // caps so that bash behaves consistently with the user-visible sandbox
        // settings. A user who raises maxMemoryMB or maxAllocations expects
        // those limits to apply to bash as well, not just the Python layer.
        executionLimits: {
            // Fixed: stack depth guard against infinite recursion, not a
            // throughput limit.
            maxCallDepth: 100,
            // Allocation-derived: scale iteration limits at 1:10 relative to
            // maxAllocations (default 100 000 → 10 000, matching the previous
            // hardcoded values).
            maxCommandCount: Math.max(1, Math.floor(maxAllocations / 10)),
            maxLoopIterations: Math.max(1, Math.floor(maxAllocations / 10)),
            maxAwkIterations: Math.max(1, Math.floor(maxAllocations / 10)),
            maxSedIterations: Math.max(1, Math.floor(maxAllocations / 10)),
            maxJqIterations: Math.max(1, Math.floor(maxAllocations / 10)),
            maxArrayElements: maxAllocations,
            // Memory-derived: allow bash output and strings up to 50% of the
            // sandbox memory cap so large intermediate data (e.g. a column
            // extracted from a 1 GB CSV) can be passed back to Python.
            maxOutputSize: Math.max(1, Math.floor(maxMemory * 0.5)),
            maxStringLength: Math.max(1, Math.floor(maxMemory * 0.5)),
            maxHeredocSize: Math.max(1, Math.floor(maxMemory * 0.5)),
        },
    });

    /**
     * Runs a shell command and returns its output.
     *
     * Runaway commands are bounded by just-bash's executionLimits (loop/awk/sed/jq
     * iteration caps), which protect against CPU-bound infinite loops.
     * When a signal is provided and aborted, the in-flight command is cancelled.
     *
     * @param command - The shell command to execute.
     * @returns A dict with stdout, stderr, and exit_code.
     */
    return async (command: string): Promise<unknown> => {
        if (typeof command !== "string") {
            throw new SandboxError(
                "TypeError",
                "bash: command must be a string",
            );
        }

        const result = await shell.exec(
            command,
            signal ? { signal } : undefined,
        );

        return {
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exitCode,
        };
    };
}
