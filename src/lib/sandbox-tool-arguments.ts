// Python-style argument binding for the AI Chat sandbox tools.
// Monty hands each external call its positional values and a dict of keyword
// values. bindSandboxToolCall matches both against the tool's declared
// parameters the way Python does, so bins=... works like a positional bins,
// and unknown, missing, or repeated arguments raise a Python TypeError
// instead of being ignored or crashing inside the tool.

import type { EXTERNAL_FUNCTIONS } from "./ai-chat-constants";
import {
    BAM_MODS_SIGNATURE,
    CONTINUE_THINKING_SIGNATURE,
    LS_SIGNATURE,
    MINIMAP2_SIGNATURE,
    PEEK_SIGNATURE,
    PLOT_HISTOGRAM_SIGNATURE,
    PLOT_SERIES_SIGNATURE,
    READ_FILE_SIGNATURE,
    READ_INFO_SIGNATURE,
    SEQ_TABLE_SIGNATURE,
    WINDOW_READS_SIGNATURE,
    WRITE_FILE_SIGNATURE,
} from "./ai-external-tools";
import { SandboxError } from "./monty-sandbox-helpers";

/** Declared Python parameters of one sandbox tool. */
export interface SandboxToolSignature {
    /** Parameters accepted by position or by keyword, in call order. */
    positional: readonly string[];
    /** How many leading positional parameters are required. */
    required: number;
    /** Parameters accepted only by keyword. */
    keywordOnly: readonly string[];
}

// Each tool file declares its own parameters next to the code that reads them.
export const /** Python parameters of every sandbox tool, keyed by tool name. */ SANDBOX_TOOL_SIGNATURES: Record<
        (typeof EXTERNAL_FUNCTIONS)[number],
        SandboxToolSignature
    > = {
        continue_thinking: CONTINUE_THINKING_SIGNATURE,
        ls: LS_SIGNATURE,
        read_file: READ_FILE_SIGNATURE,
        write_file: WRITE_FILE_SIGNATURE,
        plot_histogram: PLOT_HISTOGRAM_SIGNATURE,
        plot_series: PLOT_SERIES_SIGNATURE,
        minimap2: MINIMAP2_SIGNATURE,
        peek: PEEK_SIGNATURE,
        read_info: READ_INFO_SIGNATURE,
        bam_mods: BAM_MODS_SIGNATURE,
        window_reads: WINDOW_READS_SIGNATURE,
        seq_table: SEQ_TABLE_SIGNATURE,
    };

/**
 * Returns the edit distance between two strings (insertions, deletions and
 * substitutions each cost 1).
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns The Levenshtein distance.
 */
function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[b.length];
}

/**
 * Suggests the valid parameter name closest to a misspelled keyword, such as
 * output_path for output or mapq_filter for mapq.
 *
 * @param name - The unknown keyword the caller passed.
 * @param validNames - The tool's parameter names.
 * @returns The closest valid name, or undefined if none is close.
 */
function suggestParameterName(
    name: string,
    validNames: readonly string[],
): string | undefined {
    let best: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of validNames) {
        const distance = editDistance(name, candidate);
        const close =
            distance <= 2 ||
            candidate.includes(name) ||
            name.includes(candidate);
        if (close && distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * Formats Python's "takes N positional arguments but M were given" message.
 *
 * @param toolName - The tool's Python name.
 * @param signature - The tool's declared parameters.
 * @param given - Number of positional values passed.
 * @returns The TypeError message.
 */
function tooManyPositionalMessage(
    toolName: string,
    signature: SandboxToolSignature,
    given: number,
): string {
    const max = signature.positional.length;
    const takes =
        signature.required === max
            ? `${max} positional argument${max === 1 ? "" : "s"}`
            : `from ${signature.required} to ${max} positional arguments`;
    return `${toolName}() takes ${takes} but ${given} ${given === 1 ? "was" : "were"} given`;
}

/**
 * Matches one Python call's positional and keyword values to a tool's
 * declared parameters, raising TypeError the way Python does.
 *
 * @param toolName - The tool's Python name, used in error messages.
 * @param signature - The tool's declared parameters.
 * @param args - Positional values from the Python call.
 * @param kwargs - Keyword values from the Python call.
 * @returns One value per positional parameter (undefined when not passed),
 *   followed by an options object holding the keyword-only values passed.
 */
export function bindSandboxToolArgs(
    toolName: string,
    signature: SandboxToolSignature,
    args: readonly unknown[],
    kwargs: Record<string, unknown>,
): unknown[] {
    const { positional, required, keywordOnly } = signature;
    if (args.length > positional.length) {
        throw new SandboxError(
            "TypeError",
            tooManyPositionalMessage(toolName, signature, args.length),
        );
    }
    const values: unknown[] = positional.map((_, i) => args[i]);
    const options: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(kwargs)) {
        const index = positional.indexOf(name);
        if (index >= 0) {
            if (index < args.length) {
                throw new SandboxError(
                    "TypeError",
                    `${toolName}() got multiple values for argument '${name}'`,
                );
            }
            values[index] = value;
        } else if (keywordOnly.includes(name)) {
            options[name] = value;
        } else {
            const validNames = [...positional, ...keywordOnly].filter(
                (n) => n !== "treat_as_url",
            );
            const suggestion = suggestParameterName(name, validNames);
            throw new SandboxError(
                "TypeError",
                `${toolName}() got an unexpected keyword argument '${name}'.` +
                    (suggestion ? ` Did you mean '${suggestion}'?` : "") +
                    (validNames.length > 0
                        ? ` Valid arguments: ${validNames.join(", ")}.`
                        : ` ${toolName}() takes no arguments.`),
            );
        }
    }
    const missing = positional
        .slice(0, required)
        .filter((name, i) => i >= args.length && !Object.hasOwn(kwargs, name));
    if (missing.length > 0) {
        const quoted = missing.map((name) => `'${name}'`);
        const list =
            quoted.length === 1
                ? quoted[0]
                : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
        throw new SandboxError(
            "TypeError",
            `${toolName}() missing ${missing.length} required positional ` +
                `argument${missing.length === 1 ? "" : "s"}: ${list}`,
        );
    }
    return [...values, options];
}

/**
 * Wraps a sandbox tool so each Python call is bound to its declared
 * parameters before the tool runs. The Monty dispatcher passes the call's
 * keyword dict as the last argument; the tool instead receives its
 * positional parameters in order, then an options object.
 *
 * @param toolName - The tool's Python name, a key of SANDBOX_TOOL_SIGNATURES.
 * @param tool - The tool implementation.
 * @returns The wrapped tool.
 */
export function bindSandboxToolCall(
    toolName: keyof typeof SANDBOX_TOOL_SIGNATURES,
    tool: (...args: never[]) => unknown,
): (...args: unknown[]) => unknown {
    const signature = SANDBOX_TOOL_SIGNATURES[toolName];
    return (...callArgs: unknown[]) => {
        const kwargs = (callArgs.at(-1) ?? {}) as Record<string, unknown>;
        const bound = bindSandboxToolArgs(
            toolName,
            signature,
            callArgs.slice(0, -1),
            kwargs,
        );
        return (tool as (...a: unknown[]) => unknown)(...bound);
    };
}
