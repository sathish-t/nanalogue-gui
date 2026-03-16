// Standalone CLI for the nanalogue AI Chat feature.
// Provides an interactive REPL for LLM-powered BAM analysis without the Electron GUI.

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import { EXTERNAL_FUNCTIONS } from "./lib/ai-chat-constants";
import { CONFIG_FIELD_SPECS } from "./lib/ai-chat-shared-constants";
import {
    dumpLlmInstructions,
    getLastSentMessages,
} from "./lib/chat-orchestrator";
import { ChatSession } from "./lib/chat-session";
import type {
    AiChatConfig,
    AiChatEvent,
    SandboxResult,
} from "./lib/chat-types";
import { fetchModels } from "./lib/model-listing";
import { parseNumericArg, SANDBOX_ARG_DEFS } from "./lib/sandbox-cli-args";
import { loadSystemAppend } from "./lib/system-append";

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
    if ("NO_COLOR" in process.env) return text;
    return `${code}${text}${RESET}`;
}

// --- Argument parsing ---

/** CLI argument definitions for node:util parseArgs. */
const argConfig = {
    options: {
        endpoint: { type: "string" as const },
        "api-key": { type: "string" as const },
        model: { type: "string" as const },
        ...SANDBOX_ARG_DEFS,
        "context-window": { type: "string" as const },
        "max-retries": { type: "string" as const },
        timeout: { type: "string" as const },
        "max-code-rounds": { type: "string" as const },
        temperature: { type: "string" as const },
        "non-interactive": { type: "string" as const },
        "system-prompt": { type: "string" as const },
        "rm-tools": { type: "string" as const },
        "dump-llm-instructions": { type: "boolean" as const, default: false },
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
  --max-duration-secs <n>  Best-effort sandbox time limit in seconds (bash cancelled at limit; native reads in progress may finish) (default: ${CONFIG_FIELD_SPECS.maxDurationSecs.fallback})
  --max-memory-mb <n>      Max sandbox memory in MB (default: ${CONFIG_FIELD_SPECS.maxMemoryMB.fallback})
  --max-allocations <n>    Max sandbox VM allocations (default: ${CONFIG_FIELD_SPECS.maxAllocations.fallback})
  --max-read-mb <n>        Max read_file size in MB (default: ${CONFIG_FIELD_SPECS.maxReadMB.fallback})
  --max-write-mb <n>       Max write_file size in MB (default: ${CONFIG_FIELD_SPECS.maxWriteMB.fallback})
  --temperature <n>        LLM sampling temperature 0-2 (default: provider default)

${BOLD}Other:${RESET}
  --non-interactive <msg>  Send a single message, print the response, and exit
  --dump-llm-instructions  Dump the LLM request payload to a log file
                           (only valid with --non-interactive)
  --list-models            List available models and exit
  Note: --list-models takes precedence over --non-interactive if both are passed.
  -v, --version            Print version and exit

${BOLD}Custom system prompt:${RESET}
  --system-prompt <text>       Replace the default system prompt. Pass content
                               directly or via a shell variable:
                               --system-prompt "$MY_PROMPT"
                               --system-prompt "$(cat prompt.md)"
                               SYSTEM_APPEND.md and the facts block still apply.
                               Run /dump_system_prompt to verify.

  Place a SYSTEM_APPEND.md file in the analysis directory (--dir) to append
  additional instructions to the default (or replaced) system prompt. The
  file is read once at startup. Use /dump_system_prompt to verify the full
  effective prompt.

  --rm-tools <t1,t2,...>       Comma-separated (no spaces) list of sandbox tool
                               names to remove. Requires --system-prompt.
                               Valid names: ${EXTERNAL_FUNCTIONS.slice(0, 4).join(", ")},
                                            ${EXTERNAL_FUNCTIONS.slice(4, 8).join(", ")},
                                            ${EXTERNAL_FUNCTIONS.slice(8).join(", ")}.
                               Hard error on unknown names.

${BOLD}REPL commands:${RESET}
  /new                     Start a new conversation
  /exec <file.py>          Run a Python file directly in the sandbox
  /dump_llm_instructions   Dump the last LLM request payload to a log file
  /dump_system_prompt      Dump the static system prompt to a log file
  /quit                    Exit the CLI
  Ctrl+C during request    Cancel current request
  Ctrl+C at prompt         Exit`);
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
            console.error(
                color(
                    RED,
                    `Error: ${
                        event.isTimeout
                            ? "LLM response timed out (i.e. a message from the LLM took too much time to arrive)"
                            : event.error
                    }`,
                ),
            );
            break;
        case "turn_cancelled":
            process.stdout.write("\r\x1b[K");
            console.log(color(YELLOW, "[cancelled]"));
            break;
        default:
            break;
    }
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
    const allowedDir = values.dir
        ? resolve(process.cwd(), values.dir)
        : values.dir;
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

    // --dump-llm-instructions is only valid alongside --non-interactive.
    if (
        values["dump-llm-instructions"] &&
        values["non-interactive"] === undefined
    ) {
        console.error(
            "Error: --dump-llm-instructions requires --non-interactive",
        );
        process.exitCode = 1;
        return;
    }

    // Guard against an empty or whitespace-only --non-interactive message.
    // Using process.exitCode + return rather than process.exit() so Node drains
    // stdout and stderr naturally before terminating.
    if (
        values["non-interactive"] !== undefined &&
        values["non-interactive"].trim() === ""
    ) {
        console.error("Error: --non-interactive message cannot be empty");
        process.exitCode = 1;
        return;
    }

    // Build config from CLI args, validating each value against its allowed range.
    // All errors are collected before reporting so the user sees every problem at once.
    const configErrors: string[] = [];

    /**
     * Calls parseNumericArg, accumulates any error, and returns the fallback on failure.
     *
     * @param flagName - CLI flag name without leading dashes, used in error messages.
     * @param value - Raw string from parseArgs, or undefined if the flag was omitted.
     * @param spec - Allowed range and fallback for the field.
     * @returns The parsed integer on success, or the spec fallback on failure.
     */
    function checkedArg(
        flagName: string,
        value: string | undefined,
        spec: (typeof CONFIG_FIELD_SPECS)[keyof typeof CONFIG_FIELD_SPECS],
    ): number {
        const result = parseNumericArg(flagName, value, spec);
        if (!result.ok) {
            configErrors.push(result.error);
            return spec.fallback;
        }
        return result.value;
    }

    const config: AiChatConfig = {
        contextWindowTokens: checkedArg(
            "context-window",
            values["context-window"],
            CONFIG_FIELD_SPECS.contextWindowTokens,
        ),
        maxRetries: checkedArg(
            "max-retries",
            values["max-retries"],
            CONFIG_FIELD_SPECS.maxRetries,
        ),
        timeoutSeconds: checkedArg(
            "timeout",
            values.timeout,
            CONFIG_FIELD_SPECS.timeoutSeconds,
        ),
        maxRecordsReadInfo: checkedArg(
            "max-records-read-info",
            values["max-records-read-info"],
            CONFIG_FIELD_SPECS.maxRecordsReadInfo,
        ),
        maxRecordsBamMods: checkedArg(
            "max-records-bam-mods",
            values["max-records-bam-mods"],
            CONFIG_FIELD_SPECS.maxRecordsBamMods,
        ),
        maxRecordsWindowReads: checkedArg(
            "max-records-window-reads",
            values["max-records-window-reads"],
            CONFIG_FIELD_SPECS.maxRecordsWindowReads,
        ),
        maxRecordsSeqTable: checkedArg(
            "max-records-seq-table",
            values["max-records-seq-table"],
            CONFIG_FIELD_SPECS.maxRecordsSeqTable,
        ),
        maxCodeRounds: checkedArg(
            "max-code-rounds",
            values["max-code-rounds"],
            CONFIG_FIELD_SPECS.maxCodeRounds,
        ),
        maxDurationSecs: checkedArg(
            "max-duration-secs",
            values["max-duration-secs"],
            CONFIG_FIELD_SPECS.maxDurationSecs,
        ),
        maxMemoryMB: checkedArg(
            "max-memory-mb",
            values["max-memory-mb"],
            CONFIG_FIELD_SPECS.maxMemoryMB,
        ),
        maxAllocations: checkedArg(
            "max-allocations",
            values["max-allocations"],
            CONFIG_FIELD_SPECS.maxAllocations,
        ),
        maxReadMB: checkedArg(
            "max-read-mb",
            values["max-read-mb"],
            CONFIG_FIELD_SPECS.maxReadMB,
        ),
        maxWriteMB: checkedArg(
            "max-write-mb",
            values["max-write-mb"],
            CONFIG_FIELD_SPECS.maxWriteMB,
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

    // Report all config argument errors at once and abort.
    if (configErrors.length > 0) {
        console.error(
            `Error: invalid argument value(s):\n${configErrors.join("\n")}`,
        );
        process.exitCode = 1;
        return;
    }

    // Load SYSTEM_APPEND.md from the analysis directory if present.
    // Declared as let so it can be reloaded when the user starts a new
    // conversation with /new — ensuring any edits to the file take effect
    // immediately rather than requiring a full process restart.
    let appendSystemPrompt = await loadSystemAppend(allowedDir);

    // --system-prompt replaces the built-in sandbox prompt entirely.
    // Declared as const — it is a startup flag, not a per-directory
    // convention, so it does not reload on /new.
    // Reject empty or whitespace-only values — most likely an unset shell
    // variable (`--system-prompt "$UNSET_VAR"`), which would silently wipe
    // all built-in instructions.
    if (
        values["system-prompt"] !== undefined &&
        values["system-prompt"].trim() === ""
    ) {
        console.error("Error: --system-prompt value cannot be empty");
        process.exitCode = 1;
        return;
    }
    const replaceSystemPrompt: string | undefined = values["system-prompt"];

    // --rm-tools: parse, validate, and build the removal set.
    let removedTools: ReadonlySet<string> | undefined;
    if (values["rm-tools"] !== undefined) {
        const names = values["rm-tools"].split(",").filter(Boolean);
        if (names.length === 0) {
            console.error("Error: --rm-tools value cannot be empty");
            process.exitCode = 1;
            return;
        }
        const validTools = new Set<string>(EXTERNAL_FUNCTIONS);
        for (const name of names) {
            if (!validTools.has(name)) {
                console.error(
                    `Error: --rm-tools: unknown tool "${name}". Valid tools: ${[...EXTERNAL_FUNCTIONS].join(", ")}`,
                );
                process.exitCode = 1;
                return;
            }
        }
        removedTools = new Set(names);
    }

    if (removedTools !== undefined && replaceSystemPrompt === undefined) {
        console.error(
            "Error: --rm-tools requires --system-prompt. " +
                "Provide a custom system prompt that describes only the tools you are keeping.",
        );
        process.exitCode = 1;
        return;
    }

    const session = new ChatSession();

    // Non-interactive mode: send a single message, print the response, and exit.
    // No banner, no readline, no progress indicators — clean for scripting and piping.
    if (values["non-interactive"] !== undefined) {
        const message = values["non-interactive"];
        const result = await session.sendMessage({
            endpointUrl,
            apiKey,
            model,
            message,
            allowedDir,
            config,
            appendSystemPrompt,
            replaceSystemPrompt,
            removedTools,
            /**
             * Suppresses all progress events in non-interactive mode.
             * Only the final response text reaches stdout.
             */
            emitEvent: () => {},
        });
        if (result.success && result.text) {
            console.log(result.text);
        } else if (!result.success) {
            console.error(`Error: ${result.error}`);
        }

        // If --dump-llm-instructions was requested, write the last LLM request
        // payload to a log file in ai_chat_output/ and print the path to stderr.
        // This mirrors the /dump_llm_instructions REPL command for scripting use.
        // Errors are caught and reported cleanly — the LLM response has already
        // been printed, so a dump failure should not crash the process.
        if (values["dump-llm-instructions"]) {
            try {
                const lastSentMessages = getLastSentMessages();
                const dump = lastSentMessages
                    ? await dumpLlmInstructions(allowedDir, lastSentMessages)
                    : null;
                if (dump) {
                    console.error(`LLM instructions dumped to ${dump.log}`);
                    console.error(`HTML view: ${dump.html}`);
                } else {
                    console.error(
                        "Warning: no LLM call was made; nothing to dump.",
                    );
                }
            } catch (err) {
                console.error(
                    `Warning: failed to dump LLM instructions: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        // Use process.exitCode + return so Node drains stdout and stderr naturally.
        // Calling process.exit() directly risks truncating buffered output.
        process.exitCode = result.success ? 0 : 1;
        return;
    }

    console.log(
        `${BOLD}nanalogue-chat${RESET} connected to ${endpointUrl} using ${model}`,
    );
    console.log(`Analyzing files in: ${allowedDir}`);
    console.log(
        color(
            YELLOW,
            "Note: The AI can read and list files in the above directory. " +
                "A best-effort attempt is made to block common sensitive file types " +
                "(keys, certificates, credentials), but complete protection cannot " +
                "be guaranteed. Only use a directory whose contents you are " +
                "comfortable sharing.",
        ),
    );
    if (replaceSystemPrompt !== undefined) {
        console.log(
            color(
                YELLOW,
                "Default system prompt replaced via --system-prompt. " +
                    "Run /dump_system_prompt to verify the full effective prompt.",
            ),
        );
    }
    if (appendSystemPrompt !== undefined) {
        console.log(
            color(
                YELLOW,
                "Custom system prompt append loaded from SYSTEM_APPEND.md. " +
                    "Run /dump_system_prompt to verify the full effective prompt.",
            ),
        );
    }
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
            // Reload SYSTEM_APPEND.md so any edits since startup are picked up
            // by the fresh session without needing a process restart.
            appendSystemPrompt = await loadSystemAppend(allowedDir);
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
            appendSystemPrompt,
            replaceSystemPrompt,
            removedTools,
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
