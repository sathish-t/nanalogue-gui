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
    safeUtf8Slice,
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
 * Truncates a UTF-8 string to at most maxBytes bytes and appends a notice
 * when trimmed. The slice is delegated to safeUtf8Slice so the result is
 * always valid UTF-8.
 *
 * @param s - The string to truncate.
 * @param maxBytes - Maximum byte length.
 * @returns The (possibly truncated) string.
 */
function truncateOutput(s: string, maxBytes: number): string {
    const sliced = safeUtf8Slice(s, maxBytes);
    return sliced === s ? s : `${sliced}\n[output truncated]`;
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
 * @param timeoutMs - Per-call abort timeout in milliseconds.
 * @param maxOutputBytes - Maximum bytes for stdout/stderr before truncation.
 * @returns An async function callable from Python that runs shell commands.
 */
export function makeBash(
    allowedDir: string,
    timeoutMs: number,
    maxOutputBytes: number,
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
    });

    /**
     * Runs a shell command and returns its output.
     *
     * Uses an AbortController to enforce the per-call timeout. When the
     * timeout fires, just-bash catches the abort signal internally and
     * returns exit code 124 (same as the POSIX timeout command).
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

        const controller = new AbortController();
        // The abort callback is a safety net for commands that hang beyond
        // timeoutMs.  It is intentionally unreachable in unit tests because
        // in-process bash commands always complete (or hit just-bash's own
        // iteration limits) before the timer fires in a test environment.
        /* v8 ignore start */
        const timer = setTimeout(() => {
            controller.abort();
        }, timeoutMs); /* v8 ignore stop */

        let result: Awaited<ReturnType<typeof shell.exec>>;
        try {
            result = await shell.exec(command, { signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }

        return {
            stdout: truncateOutput(result.stdout, maxOutputBytes),
            stderr: truncateOutput(result.stderr, maxOutputBytes),
            exit_code: result.exitCode,
        };
    };
}
