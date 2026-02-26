// Standalone CLI for the nanalogue AI Chat feature.
// Provides an interactive REPL for LLM-powered BAM analysis without the Electron GUI.

import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import { CONFIG_FIELD_SPECS } from "./lib/ai-chat-shared-constants";
import { ChatSession } from "./lib/chat-session";
import type {
    AiChatConfig,
    AiChatEvent,
    SandboxResult,
} from "./lib/chat-types";
import { fetchModels } from "./lib/model-listing";

// --- ANSI color helpers ---

/** ANSI escape code prefix. */
const ESC = "\x1b[";

/** Resets all ANSI formatting. */
const RESET = `${ESC}0m`;
/** Bold text. */
const BOLD = `${ESC}1m`;
/** Dim/grey text for sandbox results. */
const DIM = `${ESC}2m`;
/** Red text for errors. */
const RED = `${ESC}31m`;
/** Yellow text for progress indicators. */
const YELLOW = `${ESC}33m`;
/** Light blue text for code blocks. */
const LIGHT_BLUE = `${ESC}94m`;

/**
 * Wraps text with an ANSI color code and reset suffix.
 *
 * @param code - The ANSI escape sequence for the color.
 * @param text - The text to colorize.
 * @returns The colorized string.
 */
function color(code: string, text: string): string {
    return `${code}${text}${RESET}`;
}

// --- Argument parsing ---

/** CLI argument definitions for node:util parseArgs. */
const argConfig = {
    options: {
        endpoint: { type: "string" as const },
        "api-key": { type: "string" as const },
        model: { type: "string" as const },
        dir: { type: "string" as const },
        "context-window": { type: "string" as const },
        "max-retries": { type: "string" as const },
        timeout: { type: "string" as const },
        "max-records-read-info": { type: "string" as const },
        "max-records-bam-mods": { type: "string" as const },
        "max-records-window-reads": { type: "string" as const },
        "max-records-seq-table": { type: "string" as const },
        "max-code-rounds": { type: "string" as const },
        "max-duration-secs": { type: "string" as const },
        "max-memory-mb": { type: "string" as const },
        "max-allocations": { type: "string" as const },
        temperature: { type: "string" as const },
        "list-models": { type: "boolean" as const, default: false },
        version: { type: "boolean" as const, short: "v", default: false },
        help: { type: "boolean" as const, short: "h", default: false },
    },
    strict: true,
} as const;

/**
 * Prints CLI usage information and exits.
 */
function printUsage(): void {
    console.log(`${BOLD}nanalogue-chat${RESET} — AI-powered BAM analysis from the terminal

${BOLD}Usage:${RESET}
  nanalogue-chat --endpoint <url> --model <name> --dir <path> [options]

${BOLD}Required:${RESET}
  --endpoint <url>         LLM endpoint URL (e.g. http://localhost:11434/v1)
  --model <name>           Model identifier (e.g. llama3)
  --dir <path>             Directory containing BAM files to analyze

${BOLD}Authentication:${RESET}
  --api-key <key>          API key (default: $API_KEY environment variable)

${BOLD}Advanced options:${RESET}
  --context-window <n>     Context window tokens (default: ${CONFIG_FIELD_SPECS.contextWindowTokens.fallback})
  --max-retries <n>        Max retries per turn (default: ${CONFIG_FIELD_SPECS.maxRetries.fallback})
  --timeout <n>            Timeout in seconds (default: ${CONFIG_FIELD_SPECS.timeoutSeconds.fallback})
  --max-records-read-info <n>    Max read_info records (default: ${CONFIG_FIELD_SPECS.maxRecordsReadInfo.fallback})
  --max-records-bam-mods <n>     Max bam_mods records (default: ${CONFIG_FIELD_SPECS.maxRecordsBamMods.fallback})
  --max-records-window-reads <n> Max window_reads records (default: ${CONFIG_FIELD_SPECS.maxRecordsWindowReads.fallback})
  --max-records-seq-table <n>    Max seq_table records (default: ${CONFIG_FIELD_SPECS.maxRecordsSeqTable.fallback})
  --max-code-rounds <n>    Max code execution rounds (default: ${CONFIG_FIELD_SPECS.maxCodeRounds.fallback})
  --max-duration-secs <n>  Max sandbox duration in seconds (default: ${CONFIG_FIELD_SPECS.maxDurationSecs.fallback})
  --max-memory-mb <n>      Max sandbox memory in MB (default: ${CONFIG_FIELD_SPECS.maxMemoryMB.fallback})
  --max-allocations <n>    Max sandbox VM allocations (default: ${CONFIG_FIELD_SPECS.maxAllocations.fallback})
  --temperature <n>        LLM sampling temperature 0-2 (default: provider default)

${BOLD}Other:${RESET}
  --list-models            List available models and exit
  -v, --version            Print version and exit

${BOLD}REPL commands:${RESET}
  /new                     Start a new conversation
  /exec <file.py>          Run a Python file directly in the sandbox
  /dump_llm_instructions   Dump the last LLM request payload to a log file
  /quit                    Exit the CLI
  Ctrl+C during request    Cancel current request
  Ctrl+C at prompt         Exit`);
}

/**
 * Parses a numeric CLI argument, clamping to the spec's min/max range.
 *
 * @param value - The raw string value from parseArgs.
 * @param spec - The config field spec with min, max, and fallback.
 * @param spec.min - Minimum allowed value (inclusive).
 * @param spec.max - Maximum allowed value (inclusive).
 * @param spec.fallback - Default value when absent or non-numeric.
 * @returns The parsed and clamped number, or the fallback.
 */
function parseNumericArg(
    value: string | undefined,
    spec: {
        /** Minimum allowed value (inclusive). */
        min: number;
        /** Maximum allowed value (inclusive). */
        max: number;
        /** Default value when absent or non-numeric. */
        fallback: number;
    },
): number {
    if (value === undefined) return spec.fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return spec.fallback;
    return Math.round(Math.max(spec.min, Math.min(spec.max, n)));
}

/**
 * Formats a sandbox result for terminal display.
 *
 * @param result - The sandbox execution result.
 * @returns A formatted string representation.
 */
function formatSandboxResult(result: SandboxResult): string {
    if (result.success) {
        const parts: string[] = [];
        if (result.prints?.length) {
            parts.push(result.prints.join(""));
        }
        if (result.endedWithExpression && result.value != null) {
            const value =
                typeof result.value === "string"
                    ? result.value
                    : JSON.stringify(result.value, null, 2);
            parts.push(value);
        }
        const text = parts.join("") || "(no output)";
        const truncNote = result.truncated ? " [truncated]" : "";
        return `${text}${truncNote}`;
    }
    return `${result.errorType}: ${result.message}`;
}

/**
 * Main entry point for the CLI.
 * Parses arguments, optionally lists models, then runs the interactive REPL.
 */
async function main(): Promise<void> {
    let parsed: ReturnType<typeof parseArgs<typeof argConfig>>;
    try {
        parsed = parseArgs(argConfig);
    } catch (error) {
        console.error(
            color(
                RED,
                `Error: ${error instanceof Error ? error.message : String(error)}`,
            ),
        );
        printUsage();
        process.exit(1);
    }

    const { values } = parsed;

    if (values.version) {
        console.log(version);
        process.exit(0);
    }

    if (values.help) {
        printUsage();
        process.exit(0);
    }

    const endpointUrl = values.endpoint;
    const apiKey = values["api-key"] ?? process.env.API_KEY ?? "";
    const model = values.model;
    const allowedDir = values.dir;
    // --list-models mode
    if (values["list-models"]) {
        if (!endpointUrl) {
            console.error(
                color(RED, "Error: --endpoint is required for --list-models"),
            );
            process.exit(1);
        }
        console.log(color(YELLOW, "[fetching models...]"));
        const result = await fetchModels(endpointUrl, apiKey);
        if (result.success) {
            for (const m of result.models) {
                console.log(m);
            }
        } else {
            console.error(color(RED, `Error: ${result.error}`));
            process.exit(1);
        }
        return;
    }

    // Validate required arguments
    if (!endpointUrl || !model || !allowedDir) {
        console.error(
            color(RED, "Error: --endpoint, --model, and --dir are required"),
        );
        printUsage();
        process.exit(1);
    }

    // Build config from CLI args, clamped to valid ranges
    const config: AiChatConfig = {
        contextWindowTokens: parseNumericArg(
            values["context-window"],
            CONFIG_FIELD_SPECS.contextWindowTokens,
        ),
        maxRetries: parseNumericArg(
            values["max-retries"],
            CONFIG_FIELD_SPECS.maxRetries,
        ),
        timeoutSeconds: parseNumericArg(
            values.timeout,
            CONFIG_FIELD_SPECS.timeoutSeconds,
        ),
        maxRecordsReadInfo: parseNumericArg(
            values["max-records-read-info"],
            CONFIG_FIELD_SPECS.maxRecordsReadInfo,
        ),
        maxRecordsBamMods: parseNumericArg(
            values["max-records-bam-mods"],
            CONFIG_FIELD_SPECS.maxRecordsBamMods,
        ),
        maxRecordsWindowReads: parseNumericArg(
            values["max-records-window-reads"],
            CONFIG_FIELD_SPECS.maxRecordsWindowReads,
        ),
        maxRecordsSeqTable: parseNumericArg(
            values["max-records-seq-table"],
            CONFIG_FIELD_SPECS.maxRecordsSeqTable,
        ),
        maxCodeRounds: parseNumericArg(
            values["max-code-rounds"],
            CONFIG_FIELD_SPECS.maxCodeRounds,
        ),
        maxDurationSecs: parseNumericArg(
            values["max-duration-secs"],
            CONFIG_FIELD_SPECS.maxDurationSecs,
        ),
        maxMemoryMB: parseNumericArg(
            values["max-memory-mb"],
            CONFIG_FIELD_SPECS.maxMemoryMB,
        ),
        maxAllocations: parseNumericArg(
            values["max-allocations"],
            CONFIG_FIELD_SPECS.maxAllocations,
        ),
        // Temperature is optional — undefined means omit from request body.
        // Reject non-finite or out-of-range values to avoid sending NaN/null to the API.
        temperature: (() => {
            if (values.temperature === undefined) return undefined;
            const t = Number.parseFloat(values.temperature);
            if (!Number.isFinite(t) || t < 0 || t > 2) {
                console.warn(
                    `Warning: ignoring invalid --temperature "${values.temperature}" (must be a number between 0 and 2)`,
                );
                return undefined;
            }
            return t;
        })(),
    };

    const session = new ChatSession();

    /**
     * Handles a progress event from the orchestrator by printing to the terminal.
     *
     * @param event - The AI Chat event to display.
     */
    function emitEvent(event: AiChatEvent): void {
        switch (event.type) {
            case "turn_start":
                process.stdout.write(color(YELLOW, "[thinking...]"));
                break;
            case "code_execution_start":
                // Clear the thinking indicator and show code
                process.stdout.write("\r\x1b[K");
                console.log(
                    color(LIGHT_BLUE, `\`\`\`python\n${event.code}\n\`\`\``),
                );
                process.stdout.write(color(YELLOW, "[running code...]"));
                break;
            case "code_execution_end":
                process.stdout.write("\r\x1b[K");
                console.log(color(DIM, formatSandboxResult(event.result)));
                break;
            case "turn_end":
                process.stdout.write("\r\x1b[K");
                break;
            case "turn_error":
                process.stdout.write("\r\x1b[K");
                console.error(color(RED, `Error: ${event.error}`));
                break;
            case "turn_cancelled":
                process.stdout.write("\r\x1b[K");
                console.log(color(YELLOW, "[cancelled]"));
                break;
            default:
                break;
        }
    }

    console.log(
        `${BOLD}nanalogue-chat${RESET} connected to ${endpointUrl} using ${model}`,
    );
    console.log(`Analyzing files in: ${allowedDir}`);
    console.log(
        `Type ${BOLD}/new${RESET} for new chat, ${BOLD}/quit${RESET} to exit.\n`,
    );

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${BOLD}You: ${RESET}`,
    });

    /** Whether a request is currently in flight. */
    let requestInFlight = false;

    // Ctrl+C handling: cancel in-flight request or exit at prompt
    rl.on("SIGINT", () => {
        if (requestInFlight) {
            session.cancel();
            requestInFlight = false;
        } else {
            console.log("\nGoodbye!");
            rl.close();
            process.exit(0);
        }
    });

    rl.prompt();

    for await (const line of rl) {
        const trimmed = line.trim();

        if (trimmed === "") {
            rl.prompt();
            continue;
        }

        if (trimmed === "/quit" || trimmed === "/exit") {
            console.log("Goodbye!");
            break;
        }

        if (trimmed === "/new") {
            session.reset();
            console.log(color(YELLOW, "[new conversation started]"));
            rl.prompt();
            continue;
        }

        requestInFlight = true;
        const result = await session.sendMessage({
            endpointUrl,
            apiKey,
            model,
            message: trimmed,
            allowedDir,
            config,
            emitEvent,
        });
        requestInFlight = false;

        // Only print assistant text here; errors are already shown by emitEvent
        if (result.success && result.text) {
            console.log(`\n${result.text}\n`);
        }

        rl.prompt();
    }

    rl.close();
}

main().catch((error) => {
    console.error(
        color(
            RED,
            `Fatal: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
    process.exit(1);
});
