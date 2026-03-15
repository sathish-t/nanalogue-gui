// External tool: plot_histogram
// Renders pre-binned histogram data as an SVG file written to the sandboxed
// directory. All path safety and file-writing is delegated to makeWriteFile
// so that every current and future plotting tool goes through a single,
// auditable path guard rather than each replicating the logic.

import { randomUUID } from "node:crypto";
import { AI_CHAT_OUTPUT_DIR } from "../ai-chat-constants";
import type { HistogramOptions } from "../histogram-renderer";
import { renderHistogramSvg } from "../histogram-renderer";
import { convertMaps, SandboxError } from "../monty-sandbox-helpers";
import type { HistogramBin } from "../stats";
import { makeWriteFile } from "./write-file";

/** Note included in every successful result to steer the LLM away from reading SVG files back. */
const WRITE_ONLY_NOTE =
    "This file cannot be read or interpreted visually by the LLM. " +
    "Report the path to the user so they can open it in a browser or image viewer.";

/**
 * Generates the auto-assigned output path for a plot when the caller does not
 * supply one. Uses the current date and a fresh UUID so filenames never clash.
 *
 * @returns A relative path of the form
 *   `ai_chat_output/nanalogue-plot-YYYY-MM-DD-<uuid>.svg`.
 */
function autoOutputPath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return `${AI_CHAT_OUTPUT_DIR}/nanalogue-plot-${date}-${randomUUID()}.svg`;
}

/**
 * Validates a single raw bin dict from Python and returns a typed HistogramBin.
 * The Python-facing keys are snake_case (bin_start, bin_end, count); they are
 * mapped to the camelCase HistogramBin type used internally.
 *
 * @param raw - A plain object or Map representing one bin from Python.
 * @param index - The zero-based index in the bins array (for error messages).
 * @returns A validated HistogramBin.
 */
function validateBin(raw: unknown, index: number): HistogramBin {
    if (typeof raw !== "object" || raw === null) {
        throw new SandboxError(
            "ValueError",
            `plot_histogram: bins[${index}] must be a dict, got ${typeof raw}`,
        );
    }
    const obj = raw as Record<string, unknown>;

    const binStart = obj.bin_start;
    const binEnd = obj.bin_end;
    const count = obj.count;

    if (typeof binStart !== "number" || !Number.isFinite(binStart)) {
        throw new SandboxError(
            "ValueError",
            `plot_histogram: bins[${index}].bin_start must be a finite number`,
        );
    }
    if (typeof binEnd !== "number" || !Number.isFinite(binEnd)) {
        throw new SandboxError(
            "ValueError",
            `plot_histogram: bins[${index}].bin_end must be a finite number`,
        );
    }
    if (binEnd <= binStart) {
        throw new SandboxError(
            "ValueError",
            `plot_histogram: bins[${index}].bin_end (${binEnd}) must be greater than bin_start (${binStart})`,
        );
    }
    if (typeof count !== "number" || !Number.isFinite(count)) {
        throw new SandboxError(
            "ValueError",
            `plot_histogram: bins[${index}].count must be a finite number`,
        );
    }
    if (count < 0) {
        throw new SandboxError(
            "ValueError",
            `plot_histogram: bins[${index}].count must be >= 0, got ${count}`,
        );
    }

    return { binStart, binEnd, count };
}

/**
 * Validates and normalises the optional xlim or ylim argument.
 *
 * @param raw - The raw value from opts (may be undefined, null, or an array).
 * @param name - "xlim" or "ylim" — used in error messages.
 * @returns A validated [min, max] tuple, or undefined if the argument was omitted.
 */
function validateLim(raw: unknown, name: string): [number, number] | undefined {
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
            `plot_histogram: ${name} must be [min, max] with min < max`,
        );
    }
    return [raw[0] as number, raw[1] as number];
}

/**
 * Validates an optional string label argument (xlabel, ylabel, title).
 *
 * @param raw - The raw value from opts.
 * @param name - Parameter name for error messages.
 * @returns The string value, or undefined if absent.
 */
function validateLabel(raw: unknown, name: string): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "string") {
        throw new SandboxError(
            "ValueError",
            `plot_histogram: ${name} must be a string`,
        );
    }
    return raw;
}

/**
 * Returns the plot_histogram tool implementation bound to the given context.
 *
 * Path safety and file-writing are fully delegated to makeWriteFile so that
 * all plotting tools share a single auditable path guard.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxWriteBytes - Maximum bytes the SVG file may occupy.
 * @returns An async function callable from Python that renders a histogram SVG.
 */
export function makePlotHistogram(
    allowedDir: string,
    maxWriteBytes: number,
): (bins: unknown, opts?: Record<string, unknown>) => Promise<unknown> {
    // Instantiate once; all path safety lives here.
    const writeFn = makeWriteFile(allowedDir, maxWriteBytes);

    /**
     * Renders a histogram SVG from pre-binned data and writes it to disk.
     *
     * The caller is responsible for computing the bins; this function only
     * renders them. Accepts all optional parameters as keyword arguments.
     *
     * @param rawBins - List of bin dicts with bin_start, bin_end, count keys.
     * @param opts - Optional parameters: output_path, xlabel, ylabel, xlim, ylim, title.
     * @returns A dict with path, bins_plotted, and a note about the file being write-only.
     */
    return async (
        rawBins: unknown,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        // --- Validate bins ---

        // Monty passes Python dicts as JS Maps; normalise to plain objects.
        const normalised = convertMaps(rawBins);

        if (!Array.isArray(normalised) || normalised.length === 0) {
            throw new SandboxError(
                "ValueError",
                "plot_histogram: bins must be a non-empty list",
            );
        }

        const bins: HistogramBin[] = normalised.map((raw, i) =>
            validateBin(raw, i),
        );

        // --- Validate optional parameters ---

        const xlabel = validateLabel(opts?.xlabel, "xlabel") ?? "x";
        const ylabel = validateLabel(opts?.ylabel, "ylabel") ?? "Count";
        const title = validateLabel(opts?.title, "title");
        const xlim = validateLim(opts?.xlim, "xlim");
        const ylim = validateLim(opts?.ylim, "ylim");

        const histOptions: HistogramOptions = { xlabel, ylabel, title };
        if (xlim) histOptions.xlim = xlim;
        if (ylim) histOptions.ylim = ylim;

        // --- Determine output path ---

        const rawOutputPath = opts?.output_path;
        let filePath: string;

        if (rawOutputPath === undefined || rawOutputPath === null) {
            filePath = autoOutputPath();
        } else {
            if (typeof rawOutputPath !== "string") {
                throw new SandboxError(
                    "ValueError",
                    "plot_histogram: output_path must be a string or None",
                );
            }
            // Enforce .svg so OS file associations work and the read_file
            // SVG block cannot be circumvented by naming the file .txt.
            if (!rawOutputPath.toLowerCase().endsWith(".svg")) {
                throw new SandboxError(
                    "ValueError",
                    "plot_histogram: output_path must end with .svg",
                );
            }
            filePath = rawOutputPath;
        }

        // --- Render SVG ---

        const svgContent = await renderHistogramSvg(bins, histOptions);

        // --- Write file (all path safety delegated to makeWriteFile) ---

        await writeFn(filePath, svgContent);

        return {
            path: filePath,
            bins_plotted: bins.length,
            note: WRITE_ONLY_NOTE,
        };
    };
}
