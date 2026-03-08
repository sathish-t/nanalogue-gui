// External tool: continue_thinking
// Signals to the orchestrator that the LLM wants another code-execution round.

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
