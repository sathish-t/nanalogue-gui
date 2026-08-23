// Standalone CLI for the nanalogue AI Chat feature.
// Provides an interactive REPL for LLM-powered BAM analysis without the Electron GUI.

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import { color, emitEvent, printUsage } from "./cli-terminal-output";
import { EXTERNAL_FUNCTIONS } from "./lib/ai-chat-constants";
import { CONFIG_FIELD_SPECS } from "./lib/ai-chat-shared-constants";
import {
    dumpConversationHistory,
    dumpLlmInstructions,
    getLastSentMessages,
} from "./lib/chat-orchestrator";
import { ChatSession } from "./lib/chat-session";
import type { AiChatConfig } from "./lib/chat-types";
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
/** Red text for errors. */
const RED = `${ESC}31m`;
/** Yellow text for progress indicators. */
const YELLOW = `${ESC}33m`;

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
        "only-system-append": { type: "boolean" as const, default: false },
        "rm-tools": { type: "string" as const },
        "dump-history": { type: "boolean" as const, default: false },
        "dump-llm-instructions": { type: "boolean" as const, default: false },
        "list-models": { type: "boolean" as const, default: false },
        version: { type: "boolean" as const, short: "v", default: false },
        help: { type: "boolean" as const, short: "h", default: false },
    },
    strict: true,
} as const;

/**
 * Main entry point for the CLI.
 * Parses arguments, optionally lists models, then runs the interactive REPL.
 */
async function main(): Promise<void> {
    let parsed: ReturnType<typeof parseArgs<typeof argConfig>>;
    try {
        parsed = parseArgs(argConfig);
    } catch (error) {
        const errorMsg: string =
            error instanceof Error ? error.message : String(error);
        assert(errorMsg.length > 0, "No error message available!");
        assert(
            errorMsg.length <= 3000,
            "Error message is too long (length > 3000)!",
        );
        console.error(color(RED, `Error: ${errorMsg}`));
        printUsage();
        process.exit(1);
    }

    const { values } = parsed;

    if (values.version) {
        assert(
            version.length > 0 && version.length <= 20,
            "Malformed version length (zero length or more than 20 characters)!",
        );
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

    // require endpointUrl
    if (!endpointUrl) {
        console.error(color(RED, "Error: --endpoint is required"));
        process.exit(1);
    } else {
        assert(
            endpointUrl.length <= 3000,
            "pathological endpoint URL detected (length > 3000)!",
        );
        assert(
            endpointUrl === endpointUrl.trim(),
            "endpointUrl has spurious whitespaces!",
        );
    }

    // check api key
    if (apiKey.length > 0) {
        assert(
            apiKey.length <= 200,
            "pathologically long api key found (length > 200)!",
        );
        assert(apiKey === apiKey.trim(), "apiKey has spurious whitespaces!");
    }

    // --list-models mode
    if (values["list-models"]) {
        console.log(color(YELLOW, "[fetching models...]"));
        const result = await fetchModels(endpointUrl, apiKey);
        if (result.success) {
            for (const m of result.models) {
                assert(
                    m.trim() === m,
                    "Model string has spurious whitespaces!",
                );
                assert(m.length > 0, "Model string is empty!");
                assert(
                    m.length <= 200,
                    "Model string is pathological (length > 200)!",
                );
                console.log(m);
            }
        } else {
            const errorMsg: string = result.error;
            assert(errorMsg.length > 0, "Error message is empty!");
            assert(
                errorMsg.length <= 3000,
                "Error message is pathological (length > 3000)!",
            );
            console.error(color(RED, `Error: ${errorMsg}`));
            process.exit(1);
        }
        return;
    }

    // Validate required arguments
    if (!model || !allowedDir) {
        console.error(color(RED, "Error: --model and --dir are required"));
        printUsage();
        process.exit(1);
    } else {
        assert(
            model.length <= 200,
            "unusually long model name detected (length > 200)!",
        );
        assert(
            allowedDir.length <= 2000,
            "unusually long allowed directory detected (length > 2000)!",
        );
        assert(model.trim() === model, "model has spurious whitespaces!");
        assert(
            allowedDir.trim() === allowedDir,
            "allowed directory has spurious whitespaces!",
        );
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

    // --dump-history is only valid alongside --non-interactive.
    if (values["dump-history"] && values["non-interactive"] === undefined) {
        console.error("Error: --dump-history requires --non-interactive");
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

    const onlySystemAppend = values["only-system-append"] === true;
    if (
        values["system-prompt"] !== undefined &&
        values["system-prompt"].trim() === ""
    ) {
        console.error("Error: --system-prompt value cannot be empty");
        process.exitCode = 1;
        return;
    }
    const replaceSystemPrompt = values["system-prompt"];
    if (onlySystemAppend && replaceSystemPrompt !== undefined) {
        console.error(
            "Error: --only-system-append cannot be combined with --system-prompt",
        );
        process.exitCode = 1;
        return;
    }

    // Load SYSTEM_APPEND.md from the analysis directory if present.
    // Declared as let so it can be reloaded when the user starts a new
    // conversation with /new — ensuring any edits to the file take effect
    // immediately rather than requiring a full process restart.
    let appendSystemPrompt = await loadSystemAppend(allowedDir);
    if (onlySystemAppend && appendSystemPrompt === undefined) {
        console.error(
            "Error: --only-system-append requires SYSTEM_APPEND.md to exist and be non-empty",
        );
        process.exitCode = 1;
        return;
    }

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
            assert(name.length > 0, "tool name unspecified in rm-tools!");
            assert(
                name.length <= 300,
                "pathologically long tool name detected (length > 300)!",
            );
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

    if (
        removedTools !== undefined &&
        !onlySystemAppend &&
        replaceSystemPrompt === undefined
    ) {
        console.error(
            "Error: --rm-tools requires --system-prompt or --only-system-append. " +
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
        const effectiveAppendSystemPrompt = onlySystemAppend
            ? undefined
            : appendSystemPrompt;
        const effectiveReplaceSystemPrompt = onlySystemAppend
            ? appendSystemPrompt
            : replaceSystemPrompt;
        const result = await session.sendMessage({
            endpointUrl,
            apiKey,
            model,
            message,
            allowedDir,
            config,
            appendSystemPrompt: effectiveAppendSystemPrompt,
            replaceSystemPrompt: effectiveReplaceSystemPrompt,
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
            const errorMsg: string = result.error;
            assert(errorMsg.length > 0, "Error message not produced!");
            assert(
                errorMsg.length <= 3000,
                "Error message is pathologically long (length > 3000)!",
            );
            console.error(`Error: ${errorMsg}`);
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
                    ? await dumpLlmInstructions(
                          allowedDir,
                          lastSentMessages,
                          model,
                      )
                    : null;
                if (dump) {
                    assert(
                        dump.log.length <= 500 &&
                            dump.log.endsWith(".log") &&
                            dump.log.length > 4,
                        "dump.log is pathological!",
                    );
                    assert(
                        dump.html.length <= 500 &&
                            dump.html.endsWith(".html") &&
                            dump.html.length > 5,
                        "dump.html is pathological!",
                    );
                    console.error(`LLM instructions dumped to ${dump.log}`);
                    console.error(`HTML view: ${dump.html}`);
                } else {
                    console.error(
                        "Warning: no LLM call was made; nothing to dump.",
                    );
                }
            } catch (err) {
                const errorMsg: string =
                    err instanceof Error ? err.message : String(err);
                assert(errorMsg.length > 0, "Error message not produced!");
                assert(
                    errorMsg.length <= 3000,
                    "Error message is pathologically long (length > 3000)!",
                );
                console.error(
                    `Warning: failed to dump LLM instructions: ${errorMsg}`,
                );
            }
        }

        // If --dump-history was requested, write the complete unpruned session
        // history without the system prompt or internal metadata.
        if (values["dump-history"]) {
            try {
                const dump =
                    session.history.length > 0
                        ? await dumpConversationHistory(
                              allowedDir,
                              session.history,
                              model,
                          )
                        : null;
                if (dump) {
                    assert(
                        dump.log.length <= 500 &&
                            dump.log.endsWith(".log") &&
                            dump.log.length > 4,
                        "dump.log is pathological!",
                    );
                    assert(
                        dump.html.length <= 500 &&
                            dump.html.endsWith(".html") &&
                            dump.html.length > 5,
                        "dump.html is pathological!",
                    );
                    console.error(`Conversation history dumped to ${dump.log}`);
                    console.error(`HTML view: ${dump.html}`);
                } else {
                    console.error(
                        "Warning: no conversation history; nothing to dump.",
                    );
                }
            } catch (err) {
                const errorMsg: string =
                    err instanceof Error ? err.message : String(err);
                assert(errorMsg.length > 0, "Error message not produced!");
                assert(
                    errorMsg.length <= 3000,
                    "Error message is pathologically long (length > 3000)!",
                );
                console.error(
                    `Warning: failed to dump conversation history: ${errorMsg}`,
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
    if (onlySystemAppend) {
        console.log(
            color(
                YELLOW,
                "SYSTEM_APPEND.md is being used as the full system prompt. " +
                    "Run /dump_system_prompt to verify the full effective prompt.",
            ),
        );
    } else if (replaceSystemPrompt !== undefined) {
        console.log(
            color(
                YELLOW,
                "Default system prompt replaced via --system-prompt. " +
                    "Run /dump_system_prompt to verify the full effective prompt.",
            ),
        );
    }
    if (!onlySystemAppend && appendSystemPrompt !== undefined) {
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

        if (trimmed === "/quit") {
            console.log("Goodbye!");
            break;
        }

        if (trimmed === "/new") {
            // Reload SYSTEM_APPEND.md so any edits since startup are picked up
            // by the fresh session without needing a process restart.
            const reloadedAppend = await loadSystemAppend(allowedDir);
            if (onlySystemAppend && reloadedAppend === undefined) {
                console.error(
                    "Error: SYSTEM_APPEND.md is required when " +
                        "--only-system-append is enabled; " +
                        "keeping the current conversation open",
                );
                rl.prompt();
                continue;
            }

            session.reset();
            appendSystemPrompt = reloadedAppend;
            console.log(color(YELLOW, "[new conversation started]"));
            rl.prompt();
            continue;
        }

        requestInFlight = true;
        const effectiveAppendSystemPrompt = onlySystemAppend
            ? undefined
            : appendSystemPrompt;
        const effectiveReplaceSystemPrompt = onlySystemAppend
            ? appendSystemPrompt
            : replaceSystemPrompt;
        const result = await session.sendMessage({
            endpointUrl,
            apiKey,
            model,
            message: trimmed,
            allowedDir,
            config,
            emitEvent,
            appendSystemPrompt: effectiveAppendSystemPrompt,
            replaceSystemPrompt: effectiveReplaceSystemPrompt,
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
