// Standalone CLI for running a Python file directly in the Monty sandbox.
// No LLM is involved — this is a pure sandbox execution tool for BAM analysis scripts.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import { DEFAULT_MAX_WRITE_BYTES } from "./lib/ai-chat-constants";
import {
    readValidatedPythonSource,
    validateAnalysisDirectory,
    validatePythonSourcePath,
} from "./lib/chat-filesystem-input-checks";
import { parseCanonicalInteger } from "./lib/chat-user-input-parsing";
import { findDuplicateCliOption } from "./lib/cli-user-input-parsing";
import { collectTerminalOutput, runSandboxCode } from "./lib/monty-sandbox";
import {
    buildSandboxRunOptions,
    SANDBOX_ARG_DEFS,
} from "./lib/sandbox-cli-args";

// --- Argument parsing ---

/** Default max output bytes: 10 MB (no LLM context to worry about). */
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

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
    tokens: true,
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
  --max-output-bytes <n>   Max inline output in decimal integer bytes (default: ${DEFAULT_MAX_OUTPUT_BYTES}).
                           Larger returned values and prints are saved in full; file notices are not clipped.
                           Outputs exceeding ${DEFAULT_MAX_WRITE_BYTES / 1024 / 1024} MiB fail instead of being partially delivered.

Sandbox limits:
  --max-records-read-info <n>    Max read_info records (default: ${200_000})
  --max-records-bam-mods <n>     Max bam_mods records (default: ${5_000})
  --max-records-window-reads <n> Max window_reads records (default: ${5_000})
  --max-records-seq-table <n>    Max seq_table records (default: ${5_000})
  --max-duration-secs <n>  Best-effort sandbox time limit in seconds (bash cancelled at limit; native reads in progress may finish) (default: ${600})
  --max-memory-mb <n>      Max sandbox memory in MB (default: ${512})
  --max-allocations <n>    Max sandbox VM allocations (default: ${100_000})
  --max-read-mb <n>        Max read_file text size in MB (BAM access is not affected) (default: ${1})
  --max-write-mb <n>       Max write_file text size in MB (BAM access is not affected) (default: ${50})

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

    const { positionals, tokens, values } = parsed;
    const duplicateOption = findDuplicateCliOption(tokens);
    if (duplicateOption !== null) {
        console.error(`Error: --${duplicateOption} may only be supplied once`);
        process.exitCode = 1;
        return;
    }

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
    try {
        validatePythonSourcePath(scriptArg);
    } catch (error) {
        console.error(
            `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
        return;
    }

    // Resolve the script from cwd; the analysis directory validator returns
    // its canonical real path so sandbox checks use a stable boundary.
    const scriptPath = resolve(process.cwd(), scriptArg);
    let allowedDir: string;
    try {
        allowedDir = await validateAnalysisDirectory(values.dir, process.cwd());
    } catch (error) {
        console.error(
            `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
        return;
    }

    // Parse --max-output-bytes up to JavaScript's safe-integer ceiling.
    const maxOutputBytes = (() => {
        const raw = values["max-output-bytes"];
        if (raw === undefined) return DEFAULT_MAX_OUTPUT_BYTES;
        const result = parseCanonicalInteger("--max-output-bytes", raw, {
            min: 1,
            max: Number.MAX_SAFE_INTEGER,
        });
        if (!result.valid) {
            console.error(`Error: ${result.error}`);
            process.exit(1);
        }
        return result.value;
    })();

    // Read the script from the filesystem (unrestricted — outside sandbox),
    // while requiring a readable regular file no larger than 10 MiB.
    let code: string;
    try {
        code = await readValidatedPythonSource(scriptPath);
    } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
        return;
    }

    // Build sandbox options from CLI values. Uses runSandboxCode directly —
    // no orphan-execution guard needed (no concurrent LLM loop to cancel).
    const sandboxOptions = buildSandboxRunOptions(values, maxOutputBytes);
    const result = await runSandboxCode(code, allowedDir, sandboxOptions);

    if (result.success) {
        const hasOutput = result.prints?.length || result.endedWithExpression;
        let output = hasOutput ? collectTerminalOutput(result) : "";
        // The collector adds a newline after an inline value; preserve exact
        // byte-boundary behavior when that newline does not fit.
        if (
            !result.outputFile &&
            result.endedWithExpression &&
            Buffer.byteLength(output, "utf-8") > maxOutputBytes &&
            output.endsWith("\n")
        ) {
            output = output.slice(0, -1);
        }
        // Silent scripts stay silent; a readability newline must also fit.
        if (
            output &&
            !output.endsWith("\n") &&
            Buffer.byteLength(output, "utf-8") < maxOutputBytes
        )
            output += "\n";

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
