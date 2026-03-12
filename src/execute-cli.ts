// Standalone CLI for running a Python file directly in the Monty sandbox.
// No LLM is involved — this is a pure sandbox execution tool for BAM analysis scripts.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import { collectTerminalOutput, runSandboxCode } from "./lib/monty-sandbox";
import { safeUtf8Slice } from "./lib/monty-sandbox-helpers";
import {
    buildSandboxRunOptions,
    SANDBOX_ARG_DEFS,
} from "./lib/sandbox-cli-args";

// --- Argument parsing ---

/** Default max output bytes: 10 MB (no LLM context to worry about). */
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/**
 * Hard ceiling for the in-memory print buffer to prevent accidental OOM when
 * a user passes a very large --max-output-bytes value. Set to 100 MB.
 */
const MAX_PRINT_BUFFER_BYTES = 100 * 1024 * 1024;

/** CLI argument definitions for node:util parseArgs. */
const argConfig = {
    options: {
        ...SANDBOX_ARG_DEFS,
        "max-output-bytes": { type: "string" as const },
        version: { type: "boolean" as const, short: "v", default: false },
        help: { type: "boolean" as const, short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
} as const;

/**
 * Writes data to stdout and waits for the buffer to drain before returning.
 * Treats EPIPE as normal early termination (consumer exited) rather than an error.
 *
 * @param data - The string to write to stdout.
 */
async function drainStdout(data: string): Promise<void> {
    await new Promise<void>((done, fail) => {
        process.stdout.write(data, (err) => {
            if (!err || (err as NodeJS.ErrnoException).code === "EPIPE") {
                done();
            } else {
                fail(err);
            }
        });
    });
}

/**
 * Prints CLI usage information to stdout.
 */
function printUsage(): void {
    console.log(`nanalogue-sandbox-exec — Run a Python script in the Monty sandbox

Usage:
  nanalogue-sandbox-exec --dir <path> <script.py>

Required:
  --dir <path>             Directory the sandbox may access (BAM files, outputs)
  <script.py>              Path to the Python script to run (resolved from cwd)

Output:
  --max-output-bytes <n>   Max output size in bytes (default: ${DEFAULT_MAX_OUTPUT_BYTES}); print() output
                           is buffered in memory up to ${MAX_PRINT_BUFFER_BYTES} bytes regardless of this value

Sandbox limits:
  --max-records-read-info <n>    Max read_info records (default: ${200_000})
  --max-records-bam-mods <n>     Max bam_mods records (default: ${5_000})
  --max-records-window-reads <n> Max window_reads records (default: ${5_000})
  --max-records-seq-table <n>    Max seq_table records (default: ${5_000})
  --max-duration-secs <n>  Best-effort sandbox time limit in seconds (bash cancelled at limit; native reads in progress may finish) (default: ${600})
  --max-memory-mb <n>      Max sandbox memory in MB (default: ${512})
  --max-allocations <n>    Max sandbox VM allocations (default: ${100_000})
  --max-read-mb <n>        Max read_file size in MB (default: ${1})
  --max-write-mb <n>       Max write_file size in MB (default: ${50})

Other:
  -v, --version            Print version and exit
  -h, --help               Show this help message

Exit codes:
  0  Sandbox ran successfully (even if no output was produced)
  1  Error (bad arguments, file not found, sandbox error)`);
}

/**
 * Main entry point for nanalogue-sandbox-exec.
 * Parses arguments, reads the script, runs it in the Monty sandbox,
 * and writes output to stdout (errors to stderr).
 */
async function main(): Promise<void> {
    let parsed: ReturnType<typeof parseArgs<typeof argConfig>>;
    try {
        parsed = parseArgs(argConfig);
    } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        printUsage();
        process.exit(1);
    }

    const { values, positionals } = parsed;

    if (values.version) {
        console.log(version);
        process.exit(0);
    }

    if (values.help) {
        printUsage();
        process.exit(0);
    }

    // Validate required arguments
    if (!values.dir) {
        console.error("Error: --dir is required");
        printUsage();
        process.exit(1);
    }

    if (positionals.length === 0) {
        console.error("Error: a Python script path is required");
        printUsage();
        process.exit(1);
    }

    if (positionals.length > 1) {
        console.error("Error: only one script path may be provided");
        printUsage();
        process.exit(1);
    }

    const scriptArg = positionals[0];
    if (!scriptArg.endsWith(".py")) {
        console.error("Error: script must be a .py file");
        process.exit(1);
    }

    // Resolve both paths to absolute so sandbox path checks work correctly
    // when the user passes a relative --dir (e.g. --dir ./data).
    const scriptPath = resolve(process.cwd(), scriptArg);
    const allowedDir = resolve(process.cwd(), values.dir);

    // Parse --max-output-bytes with no upper ceiling.
    const maxOutputBytes = (() => {
        const raw = values["max-output-bytes"];
        if (raw === undefined) return DEFAULT_MAX_OUTPUT_BYTES;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 1) {
            console.error(
                `Error: --max-output-bytes must be a positive number (got "${raw}")`,
            );
            process.exit(1);
        }
        return Math.round(n);
    })();

    // Read the script from the filesystem (unrestricted — outside sandbox).
    let code: string;
    try {
        code = await readFile(scriptPath, "utf-8");
    } catch (e) {
        console.error(
            `Error: could not read "${scriptPath}": ${e instanceof Error ? e.message : String(e)}`,
        );
        process.exit(1);
    }

    // Build sandbox options from CLI values. Uses runSandboxCode directly —
    // no orphan-execution guard needed (no concurrent LLM loop to cancel).
    // maxPrintBytes mirrors maxOutputBytes but is capped at MAX_PRINT_BUFFER_BYTES
    // to prevent accidental OOM when --max-output-bytes is set very large.
    const sandboxOptions = {
        ...buildSandboxRunOptions(values, maxOutputBytes),
        maxPrintBytes: Math.min(maxOutputBytes, MAX_PRINT_BUFFER_BYTES),
    };
    const result = await runSandboxCode(code, allowedDir, sandboxOptions);

    if (result.success) {
        // Apply --max-output-bytes to the total collected output (prints +
        // expression value). runSandboxCode only gates the expression value
        // internally; print() output must be capped here.
        // printsTruncated is true when the printCallback clipped output inside
        // runSandboxCode (single chunk exceeds the limit), so we always emit a
        // truncation marker when output was cut short for any reason.
        // Collect output directly — skip the "(No output produced.)" placeholder
        // that collectTerminalOutput adds for the chat UI; silent scripts should
        // produce empty stdout so callers can rely on exit code alone.
        const raw =
            result.prints?.length || result.endedWithExpression
                ? collectTerminalOutput(result)
                : "";
        const rawBytes = Buffer.byteLength(raw, "utf-8");
        const isTruncated =
            rawBytes > maxOutputBytes ||
            result.printsTruncated === true ||
            result.truncated === true;
        // Build the body, reserving space for the truncation note AND a
        // trailing newline, then apply a final hard clamp so stdout never
        // exceeds maxOutputBytes regardless of edge cases (e.g. when
        // maxOutputBytes is smaller than the note itself).
        let output: string;
        if (isTruncated) {
            // Include the trailing newline inside the note so the entire
            // output fits within maxOutputBytes.
            const truncNote = `\n[output truncated at ${maxOutputBytes} bytes]\n`;
            const truncNoteBytes = Buffer.byteLength(truncNote, "utf-8");
            const contentBytes = Math.max(0, maxOutputBytes - truncNoteBytes);
            output = safeUtf8Slice(
                `${safeUtf8Slice(raw, contentBytes)}${truncNote}`,
                maxOutputBytes,
            );
        } else {
            // Silent scripts (no prints, no expression) produce truly empty
            // stdout — do not add a newline so callers see zero bytes.
            // For non-empty output, add a trailing newline for terminal
            // readability only if the budget still has room.
            output =
                raw === "" || raw.endsWith("\n") || rawBytes >= maxOutputBytes
                    ? raw
                    : `${raw}\n`;
        }

        // Drain stdout before exiting so the full output reaches the next
        // process in a pipeline (drainStdout handles EPIPE gracefully).
        await drainStdout(output);
        process.exitCode = 0;
    } else {
        // Emit any print() output captured before the failure to stdout so
        // diagnostic context is visible even when the script raised an error.
        // Drain before writing stderr to preserve ordering in pipelines.
        if (result.prints && result.prints.length > 0) {
            await drainStdout(result.prints.join(""));
        }
        process.stderr.write(`${result.errorType}: ${result.message}\n`);
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
});
