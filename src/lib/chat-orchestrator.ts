// Chat orchestrator for AI Chat mode.
// Manages conversation history, context transformation, facts, and the code-only LLM loop.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
    CONFIG_FIELD_SPECS,
    DEFAULT_MAX_BLANK_RETRIES,
    DEFAULT_MAX_CODE_ROUNDS,
    DEFAULT_MAX_COMPLETION_TOKENS,
    DEFAULT_MAX_CUMULATIVE_SANDBOX_MS,
    MAX_INPUT_CONTEXT_FRACTION,
    NOMINAL_BYTES_PER_TOKEN,
} from "./ai-chat-constants";
import {
    buildExecutionFeedback,
    buildMalformedAssistantProtocolFeedback,
    detectMalformedAssistantProtocol,
    extractCodeFromFences,
    handleTerminalOverflow,
    runSandboxGuarded,
} from "./chat-orchestrator-execution";
import { addFact, evictFacts, extractFacts } from "./chat-orchestrator-facts";
import { handleDumpCommand } from "./chat-orchestrator-helpers";
import {
    applySlidingWindow,
    convertToLlmMessages,
    deriveHistoryBudgetTokens,
    pruneFailedRounds,
    transformContext,
} from "./chat-orchestrator-history";
import {
    deriveEstimatedBytesPerToken,
    fetchChatCompletion,
} from "./chat-orchestrator-llm";
import {
    dumpConversationHistory,
    dumpLlmInstructions,
} from "./chat-transcript-dump";
import type {
    AiChatConfig,
    AiChatEvent,
    Fact,
    HandleMessageResult,
    HistoryEntry,
    SandboxOptions,
    SandboxResult,
} from "./chat-types";
import {
    collectDirectExecutionOutput,
    collectTerminalOutput,
} from "./monty-sandbox";
import { deriveMaxOutputBytes, resolvePath } from "./monty-sandbox-helpers";
import {
    buildSystemPromptParts,
    joinSystemPromptParts,
} from "./sandbox-prompt";

/** A single message in the LLM request payload (system, user, or assistant). */
export interface LlmMessage {
    /** The message role. */
    role: string;
    /** The message content. */
    content: string;
}

export {
    type ChatTranscriptDumpResult,
    dumpConversationHistory,
    dumpLlmInstructions,
} from "./chat-transcript-dump";

/** Most recent messages array sent (or attempted) to the LLM API. */
let lastSentMessages: LlmMessage[] | null = null;
/** Request allowed to publish updates to lastSentMessages. */
let lastSentMessagesOwner: object = {};

/**
 * Clears the stored last-sent messages. Called by ChatSession.reset().
 */
export function resetLastSentMessages(): void {
    lastSentMessagesOwner = {};
    lastSentMessages = null;
}

/**
 * Returns the stored last-sent messages for the /dump_llm_instructions command.
 *
 * @returns The last-sent messages array, or null if no LLM call has been attempted.
 */
export function getLastSentMessages(): LlmMessage[] | null {
    return lastSentMessages;
}

/**
 * Replaces the stored last-sent messages. Used by tests to seed dump state.
 *
 * @param messages - The messages to store, or null to clear.
 */
export function setLastSentMessages(messages: LlmMessage[] | null): void {
    lastSentMessagesOwner = {};
    lastSentMessages = messages;
}

export {
    addFact,
    applySlidingWindow,
    deriveHistoryBudgetTokens,
    evictFacts,
    extractCodeFromFences,
    extractFacts,
    pruneFailedRounds,
    runSandboxGuarded,
    transformContext,
};

/** Options for the handleUserMessage orchestration function. */
export interface HandleMessageOptions {
    /** The user's message text. */
    message: string;
    /** The endpoint URL. */
    endpointUrl: string;
    /** The API key (may be empty). */
    apiKey: string;
    /** The model name. */
    model: string;
    /** The allowed directory for BAM files. */
    allowedDir: string;
    /** The orchestrator configuration. */
    config: AiChatConfig;
    /** Callback for emitting events to the renderer. */
    emitEvent: (event: AiChatEvent) => void;
    /** The conversation history (mutated in place). */
    history: HistoryEntry[];
    /** The facts array (mutated in place). */
    facts: Fact[];
    /** AbortSignal for cancellation. */
    signal: AbortSignal;
    /**
     * Optional text to append to the default system prompt, loaded from
     * SYSTEM_APPEND.md in the analysis directory. When present, it is
     * inserted between the sandbox prompt and the dynamic facts block.
     */
    appendSystemPrompt?: string;
    /**
     * Optional text to replace the default system prompt entirely. When
     * provided, buildSandboxPrompt() is not used; this text becomes the base
     * instead. AppendSystemPrompt and enabled dynamic facts still stack on top
     * in the usual order.
     */
    replaceSystemPrompt?: string;
    /** Whether accumulated facts should be appended to the system prompt. */
    includeFactsInSystemPrompt?: boolean;
    /**
     * Optional set of tool names to omit from the Monty sandbox. Each name
     * must be a member of EXTERNAL_FUNCTIONS. CLI-only feature.
     */
    removedTools?: ReadonlySet<string>;
}

/**
 * Handles a user message: builds context, calls the LLM, runs sandbox code, returns response.
 * This is the main orchestration entry point called by the IPC handler.
 *
 * @param options - The message handling options.
 * @returns The assistant's text response and steps for the code panel.
 */
export async function handleUserMessage(
    options: HandleMessageOptions,
): Promise<HandleMessageResult> {
    const {
        message,
        endpointUrl,
        apiKey,
        model,
        allowedDir,
        config,
        emitEvent,
        history,
        facts,
        signal,
        appendSystemPrompt,
        replaceSystemPrompt,
        includeFactsInSystemPrompt,
        removedTools,
    } = options;

    // Add user message to history
    history.push({ role: "user", content: message });

    // Handle /exec slash command — run a user file directly, skip the LLM.
    const execMatch = message.match(/^\/exec\s+(.+)$/);
    if (execMatch) {
        history.pop();
        const maxOutputBytes = deriveMaxOutputBytes(config.contextWindowTokens);
        emitEvent({ type: "turn_start" });
        const filePath = execMatch[1].trim();
        if (!filePath.endsWith(".py")) {
            throw new Error("/exec only supports .py files");
        }
        const resolved = await resolvePath(allowedDir, filePath);
        const code = await readFile(resolved, "utf-8");

        emitEvent({ type: "code_execution_start", code });
        const sandboxResult = await runSandboxGuarded(
            code,
            allowedDir,
            {
                maxRecordsReadInfo: config.maxRecordsReadInfo,
                maxRecordsBamMods: config.maxRecordsBamMods,
                maxRecordsWindowReads: config.maxRecordsWindowReads,
                maxRecordsSeqTable: config.maxRecordsSeqTable,
                maxOutputBytes,
                maxDurationSecs: config.maxDurationSecs,
                maxMemory: config.maxMemoryMB * 1024 * 1024,
                maxAllocations: config.maxAllocations,
                maxReadBytes: config.maxReadMB * 1024 * 1024,
                maxWriteBytes: config.maxWriteMB * 1024 * 1024,
                removedTools,
            },
            signal,
        );
        emitEvent({ type: "code_execution_end", result: sandboxResult });

        const text =
            "# Direct user execution\n" +
            "# These results do not go to the LLM, so do not reference any of these results in your LLM conversation.\n" +
            "# Any text overflow etc. are the user's responsibility.\n" +
            "# Timeouts may not apply to you (check the package's code if you want to know more).\n\n" +
            collectDirectExecutionOutput(sandboxResult);
        const steps = [{ code, result: sandboxResult }];
        emitEvent({ type: "turn_end", text, steps });
        return { text, steps };
    }

    const dumpResult = await handleDumpCommand({
        message,
        allowedDir,
        model,
        config,
        emitEvent,
        history,
        lastSentMessages,
        dumpConversationHistory,
        dumpLlmInstructions,
        appendSystemPrompt,
        replaceSystemPrompt,
    });
    if (dumpResult) {
        return dumpResult;
    }

    const requestDumpOwner = {};
    lastSentMessagesOwner = requestDumpOwner;
    let requestLastSentMessages: LlmMessage[] | null = null;
    /**
     * Updates this request's dump state and publishes it while this request owns the state.
     *
     * @param messages - Complete LLM message list for the current request.
     */
    const publishLastSentMessages = (messages: LlmMessage[]): void => {
        requestLastSentMessages = messages;
        if (lastSentMessagesOwner === requestDumpOwner) {
            lastSentMessages = messages;
        }
    };

    // Build system prompt
    const maxOutputBytes = deriveMaxOutputBytes(config.contextWindowTokens);
    const maxOutputKB = Math.round(maxOutputBytes / 1024);
    // Reuse the same derived output ceiling for both sandbox limits and the
    // default sandbox prompt so those two views of the runtime stay in sync.
    const systemPromptParts = buildSystemPromptParts({
        config,
        maxOutputKB,
        facts,
        appendSystemPrompt,
        replaceSystemPrompt,
        includeFacts: includeFactsInSystemPrompt,
    });
    const systemPrompt = joinSystemPromptParts(systemPromptParts);

    // Sandbox options
    const sandboxOptions: SandboxOptions = {
        maxRecordsReadInfo: config.maxRecordsReadInfo,
        maxRecordsBamMods: config.maxRecordsBamMods,
        maxRecordsWindowReads: config.maxRecordsWindowReads,
        maxRecordsSeqTable: config.maxRecordsSeqTable,
        maxOutputBytes,
        maxDurationSecs: config.maxDurationSecs,
        maxMemory: config.maxMemoryMB * 1024 * 1024,
        maxAllocations: config.maxAllocations,
        maxReadBytes: config.maxReadMB * 1024 * 1024,
        maxWriteBytes: config.maxWriteMB * 1024 * 1024,
        // maxPrintBytes is intentionally left at its default (MAX_PRINT_CAPTURE_BYTES,
        // 1 MB) so that large print()-based final answers are fully captured and
        // can be redirected to an overflow file by handleTerminalOverflow.
        // The LLM-facing truncation at the context budget is already enforced
        // downstream by truncatePrints() in buildExecutionFeedback.
        removedTools,
    };

    const steps: Array<{
        /** The Python code. */
        code: string;
        /** The result. */
        result: SandboxResult;
    }> = [];
    let cumulativeSandboxMs = 0;
    const maxRounds = config.maxCodeRounds ?? DEFAULT_MAX_CODE_ROUNDS;

    // Combine abort signals
    const timeoutMs =
        (config.timeoutSeconds ?? CONFIG_FIELD_SPECS.timeoutSeconds.fallback) *
        1000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

    // Effective cumulative sandbox budget: at least as large as one full
    // single-execution timeout so the invariant cumulativeBudgetMs >=
    // maxDurationSecs * 1000 always holds regardless of user config.
    const cumulativeBudgetMs = Math.max(
        DEFAULT_MAX_CUMULATIVE_SANDBOX_MS,
        config.maxDurationSecs * 1000,
    );

    emitEvent({ type: "turn_start" });

    let finalText = "";
    let estimatedBytesPerToken = NOMINAL_BYTES_PER_TOKEN;
    let blankRetriesUsed = 0;

    let round = 0;
    for (; round < maxRounds; round++) {
        // Short-circuit before calling the LLM when sandbox budget is exhausted.
        // The post-loop forced-final path sends a nudge and does one final LLM call.
        if (cumulativeSandboxMs >= cumulativeBudgetMs) break;

        // Prepare context
        const maxInputContextTokens = Math.floor(
            config.contextWindowTokens * MAX_INPUT_CONTEXT_FRACTION,
        );
        const historyBudgetTokens = deriveHistoryBudgetTokens(
            maxInputContextTokens,
            systemPrompt,
            DEFAULT_MAX_COMPLETION_TOKENS,
            estimatedBytesPerToken,
        );
        const prepared = transformContext(history, {
            contextBudgetTokens: historyBudgetTokens,
            bytesPerToken: estimatedBytesPerToken,
        });
        const llmMessages = convertToLlmMessages(prepared);

        // Store the request payload before the call so it's available
        // even if the LLM call fails (network error, 4xx, etc.)
        publishLastSentMessages([
            { role: "system", content: systemPrompt },
            ...llmMessages,
        ]);

        // Call LLM
        emitEvent({ type: "llm_request_start" });
        const completion = await fetchChatCompletion(
            endpointUrl,
            apiKey,
            model,
            systemPrompt,
            llmMessages,
            config.maxRetries,
            combinedSignal,
            config.temperature,
        );
        emitEvent({ type: "llm_request_end" });

        estimatedBytesPerToken =
            deriveEstimatedBytesPerToken(
                systemPrompt,
                llmMessages,
                completion.usage?.prompt_tokens,
            ) ?? estimatedBytesPerToken;

        const rawCode = completion.choices?.[0]?.message?.content ?? "";
        if (rawCode.trim()) blankRetriesUsed = 0;

        // Append the assistant response now that we have it
        publishLastSentMessages([
            ...(requestLastSentMessages ?? []),
            { role: "assistant", content: rawCode },
        ]);

        // Check finish_reason — "length" means response was truncated by token limit
        const finishReason = completion.choices?.[0]?.finish_reason;
        if (finishReason === "length") {
            history.push({ role: "assistant", content: rawCode });
            const truncMsg =
                "Code execution result: " +
                JSON.stringify({
                    success: false,
                    error_type: "TruncatedResponse",
                    message:
                        "Your response was truncated (output token limit reached). Please write shorter code or split your analysis into smaller steps using continue_thinking().",
                    rounds_remaining: maxRounds - (round + 1),
                });
            history.push({
                role: "user",
                content: truncMsg,
                isExecutionResult: true,
                executionStatus: "error",
            });
            continue;
        }
        if (finishReason?.includes("MALFORMED_FUNCTION_CALL")) {
            history.push({ role: "assistant", content: rawCode });
            const malformedFunctionCallMsg =
                "Code execution result: " +
                JSON.stringify({
                    success: false,
                    error_type: "MalformedFunctionCall",
                    message:
                        "The provider rejected an API function call. Do not use the model API's function-calling or tool-calling channel. Return all external function calls as raw Python source text in the assistant message content.",
                    rounds_remaining: maxRounds - (round + 1),
                });
            history.push({
                role: "user",
                content: malformedFunctionCallMsg,
                isExecutionResult: true,
                executionStatus: "error",
            });
            continue;
        }
        if (!rawCode.trim()) {
            const blankRetriesRemaining = Math.max(
                DEFAULT_MAX_BLANK_RETRIES - blankRetriesUsed,
                0,
            );
            const blankResponseMsg =
                "Code execution result: " +
                JSON.stringify({
                    success: false,
                    error_type: "BlankAssistantResponse",
                    message:
                        "The provider returned blank or missing assistant content. Return valid Python source text in the assistant message content.",
                    finish_reason: finishReason ?? null,
                    blank_retries_remaining: blankRetriesRemaining,
                    rounds_remaining: maxRounds - (round + 1),
                });
            history.push({
                role: "user",
                content: blankResponseMsg,
                isExecutionResult: true,
                executionStatus: "error",
            });
            publishLastSentMessages([
                ...(requestLastSentMessages ?? []),
                { role: "user", content: blankResponseMsg },
            ]);
            if (blankRetriesUsed < DEFAULT_MAX_BLANK_RETRIES) {
                blankRetriesUsed += 1;
                continue;
            }
            break;
        }

        const malformedProtocol = detectMalformedAssistantProtocol(rawCode);
        if (malformedProtocol) {
            history.push({ role: "assistant", content: rawCode });
            history.push({
                role: "user",
                content: buildMalformedAssistantProtocolFeedback(
                    malformedProtocol,
                    maxRounds - (round + 1),
                ),
                isExecutionResult: true,
                executionStatus: "error",
            });
            continue;
        }

        // Execute code. On SyntaxError, try markdown fence extraction.
        let code = rawCode;
        emitEvent({ type: "code_execution_start", code });
        const startTime = Date.now();
        let sandboxResult: SandboxResult;
        sandboxResult = await runSandboxGuarded(
            code,
            allowedDir,
            sandboxOptions,
            combinedSignal,
        );
        if (
            !sandboxResult.success &&
            sandboxResult.errorType === "SyntaxError"
        ) {
            const extracted = extractCodeFromFences(rawCode);
            if (extracted && extracted !== rawCode) {
                code = extracted;
                sandboxResult = await runSandboxGuarded(
                    code,
                    allowedDir,
                    sandboxOptions,
                    combinedSignal,
                );
            }
        }
        cumulativeSandboxMs += Date.now() - startTime;

        // Save the actually-executed code as assistant message
        history.push({ role: "assistant", content: code });
        emitEvent({ type: "code_execution_end", result: sandboxResult });

        steps.push({ code, result: sandboxResult });
        const roundId = `round-${randomUUID().slice(0, 8)}`;
        const roundsRemaining = maxRounds - (round + 1);

        if (sandboxResult.success) {
            extractFacts(sandboxResult, { code }, roundId, facts);

            const automaticContinuation =
                !sandboxResult.continueThinkingCalled &&
                (sandboxResult.sandboxToolCalled ||
                    sandboxResult.endedWithExpression);
            if (sandboxResult.continueThinkingCalled || automaticContinuation) {
                // Sandbox calls and bare expressions are intermediate by
                // construction, even when the model omits continue_thinking().
                const feedback = buildExecutionFeedback(
                    sandboxResult,
                    roundsRemaining,
                    automaticContinuation,
                );
                history.push({
                    role: "user",
                    content: feedback,
                    isExecutionResult: true,
                    executionStatus: "ok",
                });
            } else {
                // A terminal round is print-only and uses values already
                // available from earlier execution feedback.
                const hasOutput = (sandboxResult.prints?.length ?? 0) > 0;
                if (!hasOutput) {
                    // No output produced — feed error back so the LLM can retry
                    const noOutputMsg =
                        "Code execution result: " +
                        JSON.stringify({
                            success: true,
                            no_output: true,
                            hint: "Your code produced no output. Use print() to show results to the user.",
                            rounds_remaining: roundsRemaining,
                        });
                    history.push({
                        role: "user",
                        content: noOutputMsg,
                        isExecutionResult: true,
                        executionStatus: "error",
                    });
                } else {
                    finalText = collectTerminalOutput(sandboxResult);
                    finalText = await handleTerminalOverflow(
                        finalText,
                        allowedDir,
                    );
                    // Persist execution feedback so follow-up turns have structured context
                    const terminalFeedback = buildExecutionFeedback(
                        sandboxResult,
                        maxRounds - (round + 1),
                    );
                    history.push({
                        role: "user",
                        content: terminalFeedback,
                        isExecutionResult: true,
                        executionStatus: "ok",
                    });
                    // Store the user-facing answer as an assistant message so
                    // follow-up turns can see what was shown to the user.
                    history.push({
                        role: "assistant",
                        content: finalText,
                    });
                    // Mirror both entries into lastSentMessages so the dump
                    // transcript includes the exec result and final answer.
                    publishLastSentMessages([
                        ...(requestLastSentMessages ?? []),
                        { role: "user", content: terminalFeedback },
                        { role: "assistant", content: finalText },
                    ]);
                    break;
                }
            }
        } else {
            // Error: feed structured error back to LLM
            const feedback = buildExecutionFeedback(
                sandboxResult,
                roundsRemaining,
            );
            history.push({
                role: "user",
                content: feedback,
                isExecutionResult: true,
                executionStatus: "error",
            });
        }
    }

    // If maxRounds or sandbox budget exhausted without terminal response, do one final nudged round
    const budgetExhausted = cumulativeSandboxMs >= cumulativeBudgetMs;
    if (!finalText && (round >= maxRounds || budgetExhausted)) {
        const exhaustedMsg = budgetExhausted
            ? "Maximum cumulative sandbox runtime exceeded. Please provide your final answer now (do not call continue_thinking())."
            : "You have reached the maximum number of code execution rounds. Please provide your final answer now (do not call continue_thinking()).";
        history.push({
            role: "user",
            content: exhaustedMsg,
            isExecutionResult: true,
            executionStatus: "error",
        });

        const maxInputContextTokens = Math.floor(
            config.contextWindowTokens * MAX_INPUT_CONTEXT_FRACTION,
        );
        const historyBudgetTokens = deriveHistoryBudgetTokens(
            maxInputContextTokens,
            systemPrompt,
            DEFAULT_MAX_COMPLETION_TOKENS,
            estimatedBytesPerToken,
        );
        const prepared = transformContext(history, {
            contextBudgetTokens: historyBudgetTokens,
            bytesPerToken: estimatedBytesPerToken,
        });
        const llmMessages = convertToLlmMessages(prepared);

        // Store the request payload before the call so it's available
        // even if the LLM call fails (network error, 4xx, etc.)
        publishLastSentMessages([
            { role: "system", content: systemPrompt },
            ...llmMessages,
        ]);

        emitEvent({ type: "llm_request_start" });
        const completion = await fetchChatCompletion(
            endpointUrl,
            apiKey,
            model,
            systemPrompt,
            llmMessages,
            config.maxRetries,
            combinedSignal,
            config.temperature,
        );
        emitEvent({ type: "llm_request_end" });

        const rawFinal = completion.choices?.[0]?.message?.content ?? "";

        // Append the assistant response now that we have it
        publishLastSentMessages([
            ...(requestLastSentMessages ?? []),
            { role: "assistant", content: rawFinal },
        ]);
        const finalFinishReason = completion.choices?.[0]?.finish_reason;
        const malformedFinalProtocol =
            detectMalformedAssistantProtocol(rawFinal);
        if (finalFinishReason === "length") {
            // Truncated forced-final response — do not execute partial code.
            // Push the truncated content as assistant message for context,
            // then fall through to the fallback message.
            history.push({ role: "assistant", content: rawFinal });
        } else if (malformedFinalProtocol) {
            history.push({ role: "assistant", content: rawFinal });
            history.push({
                role: "user",
                content: buildMalformedAssistantProtocolFeedback(
                    malformedFinalProtocol,
                    0,
                ),
                isExecutionResult: true,
                executionStatus: "error",
            });
        } else if (
            rawFinal.trim() &&
            cumulativeSandboxMs >= cumulativeBudgetMs
        ) {
            // Sandbox budget exhausted — push raw response without executing
            /* c8 ignore next 3 -- requires exhausting the fixed 30-minute sandbox budget */
            finalText =
                "(Sandbox execution budget exhausted. The model's response could not be executed.)";
            history.push({ role: "assistant", content: finalText });
        } else if (rawFinal.trim()) {
            // Apply markdown fence extraction (same as main loop SyntaxError path)
            let codeToRun = rawFinal;
            emitEvent({ type: "code_execution_start", code: codeToRun });
            let result = await runSandboxGuarded(
                codeToRun,
                allowedDir,
                sandboxOptions,
                combinedSignal,
            );
            if (!result.success && result.errorType === "SyntaxError") {
                const extracted = extractCodeFromFences(rawFinal);
                if (extracted && extracted !== rawFinal) {
                    codeToRun = extracted;
                    result = await runSandboxGuarded(
                        codeToRun,
                        allowedDir,
                        sandboxOptions,
                        combinedSignal,
                    );
                }
            }
            history.push({ role: "assistant", content: codeToRun });
            emitEvent({ type: "code_execution_end", result });
            steps.push({ code: codeToRun, result });
            // Forced round: ignore continueThinkingCalled — always treat as terminal
            if (result.success) {
                extractFacts(
                    result,
                    { code: codeToRun },
                    "forced-final",
                    facts,
                );
                finalText = collectTerminalOutput(result);
                finalText = await handleTerminalOverflow(finalText, allowedDir);
            }
            // Record execution feedback for follow-up turn context
            history.push({
                role: "user",
                content: buildExecutionFeedback(result, 0),
                isExecutionResult: true,
                executionStatus: result.success ? "ok" : "error",
            });
            if (finalText) {
                history.push({
                    role: "assistant",
                    content: finalText,
                });
            }
        }
    }

    // Fallback if the model did not produce a terminal response
    if (!finalText) {
        finalText =
            "(The model did not produce a usable response. Its output may have been truncated or contained errors.)";
    }

    emitEvent({ type: "turn_end", text: finalText, steps });
    return { text: finalText, steps };
}
