// External tool: bash
// Runs shell commands in a stateful in-process bash interpreter backed by
// OverlayFs: reads come from the real filesystem, writes stay in memory only.

import { Bash, OverlayFs } from "just-bash";
import {
    isDeniedPath,
    SandboxError,
    safeUtf8Slice,
    toForwardSlashes,
} from "../monty-sandbox-helpers";

/**
 * Wraps an OverlayFs instance with a deny-list gate on read operations.
 *
 * Creates a prototypical delegate via Object.create so that all OverlayFs
 * methods (including the sync variants used by initFilesystem such as
 * mkdirSync and writeFileSync) continue to work without being enumerated here.
 * Only readFile and readFileBuffer are overridden to enforce
 * SENSITIVE_FILE_DENY_LIST, applying the same protection already present in
 * read_file() and ls(). When an inherited method (cp, chmod, utimes, …)
 * internally calls this.readFileBuffer, it calls the override — so the deny
 * list is enforced transitively for all read paths.
 *
 * @param fs - The OverlayFs instance to wrap.
 * @param mountPoint - The virtual mount point (equals allowedDir); used to
 *   derive the relative path for deny-list matching.
 * @returns An OverlayFs-compatible object that blocks reads of denied paths.
 */
function withDenyList(fs: OverlayFs, mountPoint: string): OverlayFs {
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

    // Object.create(fs) produces an object whose prototype is the OverlayFs
    // instance. Property lookups fall through to fs for everything except the
    // methods defined directly on the wrapper below, preserving the full
    // OverlayFs surface (including mkdirSync/writeFileSync needed by Bash's
    // internal initFilesystem call).
    const wrapper = Object.create(fs) as OverlayFs;

    /**
     * Deny-list-gated readFile: checks the path before delegating to the
     * underlying OverlayFs instance.
     *
     * @param path - Virtual path to read.
     * @param options - Encoding options forwarded to OverlayFs.readFile.
     * @returns The file contents as a string.
     */
    wrapper.readFile = async (
        path: string,
        options?: Parameters<OverlayFs["readFile"]>[1],
    ): Promise<string> => {
        checkPath(path);
        return fs.readFile(path, options);
    };

    /**
     * Deny-list-gated readFileBuffer: checks the path before delegating to
     * the underlying OverlayFs instance.
     *
     * @param path - Virtual path to read.
     * @returns The file contents as a Uint8Array.
     */
    wrapper.readFileBuffer = async (path: string): Promise<Uint8Array> => {
        checkPath(path);
        return fs.readFileBuffer(path);
    };

    /**
     * Filtered readdir: removes entries whose names match the deny list so
     * that commands such as ls and find cannot enumerate sensitive file names.
     *
     * @param path - Virtual path of the directory to list.
     * @returns Names of non-denied directory entries.
     */
    wrapper.readdir = async (path: string): Promise<string[]> => {
        const entries = await fs.readdir(path);
        return entries.filter((name) => !isHiddenEntry(path, name));
    };

    /**
     * Filtered readdirWithFileTypes: same as readdir but preserves dirent
     * metadata, used by commands such as ls -l.
     *
     * @param path - Virtual path of the directory to list.
     * @returns Dirent objects for non-denied directory entries.
     */
    wrapper.readdirWithFileTypes = async (
        path: string,
    ): ReturnType<OverlayFs["readdirWithFileTypes"]> => {
        const entries = await fs.readdirWithFileTypes(path);
        return entries.filter((e) => !isHiddenEntry(path, e.name));
    };

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
 * Creates one OverlayFs (root = allowedDir, mountPoint = allowedDir) wrapped
 * with the sensitive-file deny list, and one Bash instance reused across all
 * bash() calls within a single sandbox execution round. Filesystem writes
 * made in bash persist between calls (the OverlayFs is shared); shell state
 * such as cwd and variables does not persist between calls.
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
    const overlayFs = new OverlayFs({
        root: allowedDir,
        mountPoint: allowedDir,
    });

    const shell = new Bash({
        fs: withDenyList(overlayFs, allowedDir),
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
