// Shared utilities for SVG plotting tools (plot_histogram, plot_series, etc.).
// Kept here so each tool does not duplicate identical constants and helpers.

import { randomUUID } from "node:crypto";
import { AI_CHAT_OUTPUT_DIR } from "../ai-chat-constants";
import { SandboxError } from "../monty-sandbox-helpers";

/**
 * Note included in every successful plot result to steer the LLM away from
 * reading SVG files back via read_file().
 */
export const /** Note included in every successful plot result to steer the LLM away from reading SVG files back via read_file(). */ WRITE_ONLY_NOTE =
        "This file cannot be read or interpreted visually by the LLM. " +
        "Report the path to the user so they can open it in a browser or image viewer.";

/**
 * Generates the auto-assigned output path for a plot when the caller does not
 * supply one. Uses the current date and a fresh UUID so filenames never clash.
 *
 * @returns A relative path of the form
 *   `ai_chat_output/nanalogue-plot-YYYY-MM-DD-<uuid>.svg`.
 */
export function autoOutputPath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return `${AI_CHAT_OUTPUT_DIR}/nanalogue-plot-${date}-${randomUUID()}.svg`;
}

/**
 * Validates and normalises the optional xlim or ylim argument.
 *
 * @param raw - The raw value from opts (may be undefined, null, or an array).
 * @param name - "xlim" or "ylim" — used in error messages.
 * @param prefix - The calling tool name used as the error message prefix (e.g. "plot_histogram").
 * @returns A validated [min, max] tuple, or undefined if the argument was omitted.
 */
export function validateLim(
    raw: unknown,
    name: string,
    prefix: string,
): [number, number] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (
        !Array.isArray(raw) ||
        raw.length !== 2 ||
        typeof raw[0] !== "number" ||
        typeof raw[1] !== "number" ||
        !Number.isFinite(raw[0]) ||
        !Number.isFinite(raw[1]) ||
        raw[0] >= raw[1]
    ) {
        throw new SandboxError(
            "ValueError",
            `${prefix}: ${name} must be [min, max] with min < max`,
        );
    }
    return [raw[0] as number, raw[1] as number];
}

/**
 * Validates an optional string label argument (xlabel, ylabel, title).
 *
 * @param raw - The raw value from opts.
 * @param name - Parameter name for error messages.
 * @param prefix - The calling tool name used as the error message prefix (e.g. "plot_histogram").
 * @returns The string value, or undefined if absent.
 */
export function validateLabel(
    raw: unknown,
    name: string,
    prefix: string,
): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "string") {
        throw new SandboxError(
            "ValueError",
            `${prefix}: ${name} must be a string`,
        );
    }
    return raw;
}
