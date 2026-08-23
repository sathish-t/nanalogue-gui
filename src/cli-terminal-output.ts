// Terminal output helpers for the standalone nanalogue-chat CLI.

import assert from "node:assert/strict";
import { EXTERNAL_FUNCTIONS } from "./lib/ai-chat-constants";
import { CONFIG_FIELD_SPECS } from "./lib/ai-chat-shared-constants";
import type { AiChatEvent, SandboxResult } from "./lib/chat-types";

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
/** Returns the cursor to column 0 and clears the current line. */
const CLEAR_LINE = "\r\x1b[K";

/**
 * Wraps text with an ANSI color code and reset suffix.
 *
 * @param code - The ANSI escape sequence for the color.
 * @param text - The text to colorize.
 * @returns The colorized string.
 */
export function color(code: string, text: string): string {
    assert(
        code.trim().length > 0 && code.trim().length < 10,
        "Invalid ANSI color code",
    );
    if (text.length === 0 || "NO_COLOR" in process.env) return text;
    return `${code.trim()}${text}${RESET}`;
}

/**
 * Prints CLI usage information and exits.
 */
export function printUsage(): void {
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
  --max-read-mb <n>        Max read_file text size in MB (BAM access is not affected) (default: ${CONFIG_FIELD_SPECS.maxReadMB.fallback})
  --max-write-mb <n>       Max write_file text size in MB (BAM access is not affected) (default: ${CONFIG_FIELD_SPECS.maxWriteMB.fallback})
  --temperature <n>        LLM sampling temperature 0-2 (default: provider default)

${BOLD}Other:${RESET}
  --non-interactive <msg>  Send a single message, print the response, and exit
  --dump-history           Dump the complete raw conversation history
                           (only valid with --non-interactive)
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
                               SYSTEM_APPEND.md still applies.
  --only-system-append         Use SYSTEM_APPEND.md as the full system prompt
                               without the built-in prompt.
                               Requires SYSTEM_APPEND.md to exist and be
                               non-empty in the analysis directory (--dir).
                               Cannot be combined with --system-prompt.
                               Run /dump_system_prompt to verify.

  Place a SYSTEM_APPEND.md file in the analysis directory (--dir) to append
  additional instructions to the default (or replaced) system prompt. The
  file is read once at startup. Use /dump_system_prompt to verify the full
  effective prompt.

  --rm-tools <t1,t2,...>       Comma-separated (no spaces) list of sandbox tool
                               names to remove. Requires --system-prompt or
                               --only-system-append.
                               Valid names: ${EXTERNAL_FUNCTIONS.slice(0, 4).join(", ")},
                                            ${EXTERNAL_FUNCTIONS.slice(4, 8).join(", ")},
                                            ${EXTERNAL_FUNCTIONS.slice(8).join(", ")}.
                               Hard error on unknown names.

${BOLD}REPL commands:${RESET}
  /new                     Start a new conversation
  /exec <file.py>          Run a Python file directly in the sandbox
  /dump_history            Dump the complete raw conversation history
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

    const errorType = result.errorType;
    const errorMsg = result.message;
    assert(errorType.length <= 3000, "Error type is too long (length > 3000)!");
    assert(
        errorMsg.length <= 3000,
        "Error message is too long (length > 3000)!",
    );
    assert(errorType.length > 0, "Error type is missing!");
    assert(errorMsg.length > 0, "Error message is missing!");
    return `${errorType}: ${errorMsg}`;
}

/**
 * Handles a progress event from the orchestrator by printing to the terminal.
 *
 * @param event - The AI Chat event to display.
 */
export function emitEvent(event: AiChatEvent): void {
    switch (event.type) {
        case "turn_start":
            process.stdout.write(color(YELLOW, "[thinking...]"));
            break;
        case "code_execution_start":
            process.stdout.write(CLEAR_LINE);
            console.log(
                color(LIGHT_BLUE, `\`\`\`python\n${event.code}\n\`\`\``),
            );
            process.stdout.write(color(YELLOW, "[running code...]"));
            break;
        case "code_execution_end":
            process.stdout.write(CLEAR_LINE);
            console.log(color(DIM, formatSandboxResult(event.result)));
            break;
        case "turn_end":
            process.stdout.write(CLEAR_LINE);
            break;
        case "turn_error": {
            process.stdout.write(CLEAR_LINE);
            const errorMsg: string = event.error;
            assert(errorMsg.length > 0, "Error message is missing");
            assert(
                errorMsg.length <= 3000,
                "Error message is pathologically long (length > 3000)!",
            );
            console.error(
                color(
                    RED,
                    `Error: ${
                        event.isTimeout
                            ? "LLM response timed out (i.e. a message from the LLM took too much time to arrive)"
                            : errorMsg
                    }`,
                ),
            );
            break;
        }
        case "turn_cancelled":
            process.stdout.write(CLEAR_LINE);
            console.log(color(YELLOW, "[cancelled]"));
            break;
        default:
            break;
    }
}
