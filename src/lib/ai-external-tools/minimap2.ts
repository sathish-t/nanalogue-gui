// External tool: minimap2
// Runs minimap2 alignment via the biowasm WASM build.
// Always outputs PAF format. Both input files are validated against allowedDir
// before being read from disk and written into Emscripten's virtual filesystem.
// The WASM module is re-instantiated on every call for isolation — minimap2's
// C main() uses global state that is not safe to reuse across calls.

import { realpathSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    MINIMAP2_MAX_INPUT_BYTES,
    MINIMAP2_PRESETS,
} from "../ai-chat-constants";
import {
    isDeniedPath,
    resolvePath,
    SandboxError,
    toForwardSlashes,
} from "../monty-sandbox-helpers";

/** The Emscripten module interface exposed by the biowasm minimap2.js bundle. */
interface Minimap2Module {
    /** Emscripten virtual filesystem API. */
    FS: {
        /** Writes data into the virtual filesystem at the given path. */
        writeFile(path: string, data: string | ArrayBufferView): void;
        /** Removes a file from the virtual filesystem. */
        unlink(path: string): void;
    };
    /**
     * Invokes minimap2's C main() with the given argument list.
     * May throw an Emscripten ExitStatus object (with a numeric `status`
     * property) when the program calls exit() — even on exit code 0.
     */
    callMain(args: string[]): number | void;
}

/**
 * Shape of the module returned by dynamically importing the biowasm minimap2.js
 * bundle. Node.js exposes a CJS module's module.exports as the default export
 * when imported via import().
 */
interface Minimap2ModuleExport {
    /** The factory function that initialises a fresh minimap2 WASM instance. */
    default: Minimap2Factory;
}

/** The factory function exported by the biowasm minimap2.js bundle. */
type Minimap2Factory = (config: {
    /** Pre-loaded WASM binary; bypasses the Emscripten fetch() call. */
    wasmBinary: Buffer;
    /** Redirects asset lookups (e.g. Minimap2.data) to the local filesystem. */
    locateFile(filename: string): string;
    /** Receives lines written to stdout (PAF output). */
    print(text: string): void;
    /** Receives lines written to stderr (progress and log messages). */
    printErr(text: string): void;
    /** Called once the WASM runtime and virtual filesystem are fully ready. */
    onRuntimeInitialized(): void;
}) => Promise<Minimap2Module>;

/**
 * Resolves the directory containing the biowasm minimap2 assets at runtime.
 *
 * Two esbuild output formats are in use:
 * - CJS (dist/main.js): __dirname is provided natively by Node.js CJS.
 * - ESM (dist/cli.mjs, dist/execute-cli.mjs): __dirname is not defined.
 *   Falls back to dirname(realpathSync(process.argv[1])), resolving any
 *   symlinks first so that global npm bin shims (which set argv[1] to the
 *   shim path rather than the actual bundle) still yield the correct dist/
 *   directory where minimap2-wasm/ lives.
 *
 * Typeof __dirname never throws (safe even when the variable is undeclared),
 * making this guard safe in both CJS and ESM Node.js contexts..
 *
 * @returns The absolute path to the minimap2-wasm asset directory.
 */
function getAssetDir(): string {
    const base =
        typeof __dirname !== "undefined"
            ? __dirname
            : /* c8 ignore next -- ESM bundle path; __dirname is always defined in the CJS test environment */
              dirname(realpathSync(process.argv[1] ?? ""));
    return join(base, "minimap2-wasm");
}

/** Cached result of getAssetDir() — computed once on first use. */
let assetDirCache: string | null = null;

/**
 * Returns the minimap2 asset directory, computing and caching it on first call.
 *
 * @returns The absolute path to the minimap2-wasm asset directory.
 */
function assetDir(): string {
    if (assetDirCache === null) {
        assetDirCache = getAssetDir();
    }
    return assetDirCache;
}

/**
 * Cached WASM binary buffer. Loaded from disk lazily on the first call and
 * reused for all subsequent calls to avoid repeated disk reads.
 */
let wasmBinaryCache: Buffer | null = null;

/**
 * Returns the minimap2 WASM binary, reading it from disk on the first call.
 *
 * @returns The WASM binary as a Buffer.
 */
async function getWasmBinary(): Promise<Buffer> {
    if (wasmBinaryCache === null) {
        wasmBinaryCache = await readFile(join(assetDir(), "minimap2.wasm"));
    }
    return wasmBinaryCache;
}

/** Progress event shape used by the XHR stub's onprogress callback. */
interface XhrProgressEvent {
    /** Number of bytes received so far. */
    loaded: number;
    /** Total number of bytes expected. */
    total: number;
}

// Install a minimal XMLHttpRequest stub on the Node.js global once at
// module-load time. Emscripten's .data package loader uses XHR to fetch the
// virtual filesystem image; this stub intercepts those requests and serves
// the file from the local filesystem instead. Node.js never sets
// XMLHttpRequest natively, so the guard below is purely defensive.
if (!(global as Record<string, unknown>).XMLHttpRequest) {
    (global as Record<string, unknown>).XMLHttpRequest = class {
        /** The URL supplied to open(). */
        private _url = "";
        /** The responseType value supplied by the caller. */
        private _responseType = "";
        /** XHR ready state (4 = DONE). */
        readyState = 0;
        /** HTTP-style status code (200 = OK). */
        status = 0;
        /** The response body set after a successful read. */
        response: unknown = null;
        /** Fired on successful load. */
        onload?: (event: unknown) => void;
        /** Fired on error. */
        onerror?: (event: unknown) => void;
        /** Fired with progress updates. */
        onprogress?: (event: XhrProgressEvent) => void;

        /**
         * Sets the response type requested by the caller.
         *
         * @param v - The response type string (e.g. "arraybuffer").
         */
        set responseType(v: string) {
            this._responseType = v;
        }

        /**
         * Returns the response type set by the caller.
         *
         * @returns The current response type string.
         */
        get responseType(): string {
            /* c8 ignore next -- Emscripten sets responseType but never reads it back */
            return this._responseType;
        }

        /**
         * Records the request URL. Only GET is used by Emscripten's loader.
         *
         * @param _method - The HTTP method (always GET here).
         * @param url - The URL or file:// path to read.
         */
        open(_method: string, url: string): void {
            this._url = url;
        }

        /**
         * Reads the target file asynchronously and fires onload with the
         * contents as an ArrayBuffer, matching the browser XHR contract.
         */
        send(): void {
            void (async () => {
                try {
                    const filePath = this._url.startsWith("file://")
                        ? fileURLToPath(this._url)
                        : this._url;
                    const buf = await readFile(filePath);
                    this.readyState = 4;
                    this.status = 200;
                    this.response = buf.buffer.slice(
                        buf.byteOffset,
                        buf.byteOffset + buf.byteLength,
                    );
                    if (this.onprogress) {
                        this.onprogress({
                            loaded: buf.length,
                            total: buf.length,
                        });
                    }
                    if (this.onload) this.onload({});
                } catch (e) {
                    this.status = 0;
                    if (this.onerror) this.onerror(e);
                }
            })();
        }
    };
}

/**
 * Resolves a file path against allowedDir, rejects path-traversal and symlink
 * escapes via resolvePath(), then checks the result against the sensitive-file
 * deny list.
 *
 * @param allowedDir - The sandboxed root directory.
 * @param filePath - The path supplied by the LLM.
 * @returns The resolved absolute path, guaranteed to be inside allowedDir and
 *   not on the deny list.
 */
async function resolveAndCheck(
    allowedDir: string,
    filePath: string,
): Promise<string> {
    const resolved = await resolvePath(allowedDir, filePath);
    const allowedDirReal = await realpath(allowedDir);
    const relResolved = toForwardSlashes(relative(allowedDirReal, resolved));
    if (isDeniedPath(relResolved)) {
        throw new SandboxError(
            "OSError",
            `Reading "${filePath}" is not permitted`,
        );
    }
    return resolved;
}

/**
 * Returns the minimap2 tool implementation bound to the given allowed directory.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @returns An async function callable from Python that returns PAF output.
 */
export function makeRunMinimap2(
    allowedDir: string,
): (
    refPath: string,
    queryPath: string,
    opts?: Record<string, unknown> | string,
) => Promise<unknown> {
    /**
     * Runs minimap2 alignment and returns PAF output plus stderr.
     *
     * @param refPath - Path to the reference FASTA/FASTQ file, relative to allowedDir.
     * @param queryPath - Path to the query FASTA/FASTQ file, relative to allowedDir.
     * @param opts - Optional preset string or options object with a preset key.
     *   Accepts a bare string (positional preset) or `{ preset: "..." }` to
     *   accommodate both Python calling conventions: `minimap2(ref, q, "sr")` and
     *   `minimap2(ref, q, preset="sr")`.
     * @returns A dict with paf (string) and stderr (string).
     */
    return async (
        refPath: string,
        queryPath: string,
        opts?: Record<string, unknown> | string,
    ): Promise<unknown> => {
        // Normalise: a bare positional string is treated as the preset value.
        if (
            opts !== undefined &&
            typeof opts !== "string" &&
            (typeof opts !== "object" || opts === null || Array.isArray(opts))
        ) {
            throw new SandboxError(
                "TypeError",
                "minimap2: third argument must be a preset string or an options object",
            );
        }
        const normalizedOpts: Record<string, unknown> | undefined =
            typeof opts === "string" ? { preset: opts } : opts;
        // --- Validate argument types ---
        if (typeof refPath !== "string") {
            throw new SandboxError(
                "TypeError",
                "minimap2: reference_path must be a string",
            );
        }
        if (typeof queryPath !== "string") {
            throw new SandboxError(
                "TypeError",
                "minimap2: query_path must be a string",
            );
        }

        // --- Validate preset ---
        const preset = normalizedOpts?.preset ?? null;
        if (preset !== null) {
            if (typeof preset !== "string") {
                throw new SandboxError(
                    "TypeError",
                    "minimap2: preset must be a string",
                );
            }
            if (!(MINIMAP2_PRESETS as readonly string[]).includes(preset)) {
                throw new SandboxError(
                    "ValueError",
                    `minimap2: unknown preset "${preset}". Valid presets: ${MINIMAP2_PRESETS.join(", ")}`,
                );
            }
        }

        // --- Resolve and validate file paths ---
        const resolvedRef = await resolveAndCheck(allowedDir, refPath);
        const resolvedQuery = await resolveAndCheck(allowedDir, queryPath);

        // --- Enforce file size caps before reading ---
        const maxMB = MINIMAP2_MAX_INPUT_BYTES / (1024 * 1024);
        const refStat = await stat(resolvedRef);
        if (refStat.size > MINIMAP2_MAX_INPUT_BYTES) {
            throw new SandboxError(
                "ValueError",
                `minimap2: reference file is ${refStat.size} bytes, exceeds the ${maxMB} MB limit`,
            );
        }
        const queryStat = await stat(resolvedQuery);
        if (queryStat.size > MINIMAP2_MAX_INPUT_BYTES) {
            throw new SandboxError(
                "ValueError",
                `minimap2: query file is ${queryStat.size} bytes, exceeds the ${maxMB} MB limit`,
            );
        }

        // --- Read input files from real disk ---
        const refData = await readFile(resolvedRef);
        const queryData = await readFile(resolvedQuery);

        // --- Build callMain args ---
        const args: string[] = [];
        if (preset !== null) {
            args.push("-x", preset);
        }
        args.push("/ref", "/query");

        // --- Instantiate the WASM module and run ---
        const pafLines: string[] = [];
        const stderrLines: string[] = [];
        const wasmBinary = await getWasmBinary();

        // Dynamic import() keeps esbuild from bundling the pre-built Emscripten
        // JS glue file. Unlike require(), import() works in both CJS
        // (dist/main.js) and ESM (dist/cli.mjs, dist/execute-cli.mjs) bundles.
        // pathToFileURL produces a valid file:// URL for Node.js import() in
        // all environments. Node.js caches import() by URL so the module is
        // only parsed once across all calls, matching require() cache behaviour.
        // When Node.js imports a CJS module the entire module.exports becomes
        // the default export, so .default gives us the factory function.
        const mod = (await import(
            pathToFileURL(join(assetDir(), "minimap2.js")).href
        )) as unknown as Minimap2ModuleExport;
        const factory = mod.default;

        const m = await factory({
            wasmBinary,
            /**
             * Redirects Emscripten asset lookups to the local asset directory.
             *
             * @param filename - The asset filename requested by Emscripten (e.g. "minimap2.data").
             * @returns A file:// URL pointing to the asset in the local minimap2-wasm directory.
             */
            locateFile: (filename: string) =>
                pathToFileURL(join(assetDir(), filename)).href,
            /**
             * Collects a line of stdout output (PAF alignment records) from minimap2.
             *
             * @param text - A line written to stdout by minimap2.
             */
            print: (text: string) => {
                pafLines.push(text);
            },
            /**
             * Collects a line of stderr output (progress and log messages) from minimap2.
             *
             * @param text - A line written to stderr by minimap2.
             */
            printErr: (text: string) => {
                stderrLines.push(text);
            },
            /**
             * No-op runtime-initialized callback.
             * All post-initialization work is done after the factory promise resolves.
             */
            onRuntimeInitialized() {
                // No-op: all work is done after the factory promise resolves.
            },
        });

        // Write input data into Emscripten's virtual filesystem
        m.FS.writeFile("/ref", refData);
        m.FS.writeFile("/query", queryData);

        // Emscripten throws an ExitStatus object (with a numeric `status`
        // property) when the C program calls exit(). Capture the exit code so
        // we can distinguish a genuine "no alignments" (exitCode 0, empty PAF)
        // from a hard failure (exitCode != 0, e.g. malformed FASTA input).
        let exitCode: number;
        try {
            exitCode = m.callMain(args) ?? 0;
            // c8 ignore start -- Emscripten ExitStatus throw cannot be reliably
            // triggered from the WASM boundary in unit tests.
        } catch (e) {
            if (
                e !== null &&
                typeof e === "object" &&
                "status" in e &&
                typeof (
                    e as {
                        /** Emscripten exit status code. */
                        status: unknown;
                    }
                ).status === "number"
            ) {
                exitCode = (
                    e as {
                        /** Emscripten exit status code. */
                        status: number;
                    }
                ).status;
            } else {
                throw e;
            }
        } finally {
            // c8 ignore stop
            // Clean up virtual FS entries regardless of success or failure
            try {
                m.FS.unlink("/ref");
            } catch {
                // ignore cleanup errors
            }
            try {
                m.FS.unlink("/query");
            } catch {
                // ignore cleanup errors
            }
        }

        // c8 ignore start -- minimap2 exits 0 for most inputs (empty PAF for
        // no mappings); non-zero exits require internal WASM failures that
        // cannot be reliably triggered in unit tests.
        if (exitCode !== 0) {
            throw new SandboxError(
                "RuntimeError",
                `minimap2 exited with code ${exitCode}. stderr: ${stderrLines.join("\n")}`,
            );
        }
        // c8 ignore stop

        return {
            paf: pafLines.join("\n"),
            stderr: stderrLines.join("\n"),
        };
    };
}
