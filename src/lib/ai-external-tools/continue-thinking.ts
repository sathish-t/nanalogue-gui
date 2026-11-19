// External tool: continue_thinking
// Signals to the orchestrator that the LLM wants another code-execution round.

import type { SandboxToolSignature } from "../sandbox-tool-arguments";

export const /** Python parameters of continue_thinking(), matched to each call by bindSandboxToolCall. */ CONTINUE_THINKING_SIGNATURE: SandboxToolSignature =
        { positional: [], required: 0, keywordOnly: [] };

/**
 * Returns the continue_thinking tool implementation.
 *
 * @param onCalled - Callback invoked when Python calls continue_thinking().
 * @returns A function that sets the flag and returns null to Python.
 */
export function makeContinueThinking(onCalled: () => void): () => null {
    return () => {
        onCalled();
        return null;
    };
}
