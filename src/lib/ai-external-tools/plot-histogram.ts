// External tool: plot_histogram
// Renders pre-binned histogram data as an SVG file written to the sandboxed
// directory. All path safety and file-writing is delegated to makeWriteFile
// so that every current and future plotting tool goes through a single,
// auditable path guard rather than each replicating the logic.

import type { HistogramOptions } from "../histogram-renderer";
import { renderHistogramSvg } from "../histogram-renderer";
import { convertMaps, SandboxError } from "../monty-sandbox-helpers";
import type { HistogramBin } from "../stats";
import {
    autoOutputPath,
    validateLabel,
    validateLim,
    WRITE_ONLY_NOTE,
} from "./plot-utils";
import { makeWriteFile } from "./write-file";

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

        const xlabel =
            validateLabel(opts?.xlabel, "xlabel", "plot_histogram") ?? "x";
        const ylabel =
            validateLabel(opts?.ylabel, "ylabel", "plot_histogram") ?? "Count";
        const title = validateLabel(opts?.title, "title", "plot_histogram");
        const xlim = validateLim(opts?.xlim, "xlim", "plot_histogram");
        const ylim = validateLim(opts?.ylim, "ylim", "plot_histogram");

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
