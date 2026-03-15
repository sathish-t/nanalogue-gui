// External tool: plot_series
// Renders x/y point data as a line or scatter SVG file written to the
// sandboxed directory. All path safety and file-writing is delegated to
// makeWriteFile so that every plotting tool goes through a single,
// auditable path guard rather than each replicating the logic.

import { convertMaps, SandboxError } from "../monty-sandbox-helpers";
import type { XYPoint } from "../stats";
import type { SeriesKind, XYOptions } from "../xy-renderer";
import { renderXySvg } from "../xy-renderer";
import {
    autoOutputPath,
    validateLabel,
    validateLim,
    WRITE_ONLY_NOTE,
} from "./plot-utils";
import { makeWriteFile } from "./write-file";

/**
 * Validates a single raw point dict from Python and returns a typed XYPoint.
 *
 * @param raw - A plain object or Map representing one point from Python.
 * @param index - The zero-based index in the points array (for error messages).
 * @returns A validated XYPoint.
 */
function validatePoint(raw: unknown, index: number): XYPoint {
    if (typeof raw !== "object" || raw === null) {
        throw new SandboxError(
            "ValueError",
            `plot_series: points[${index}] must be a dict, got ${typeof raw}`,
        );
    }
    const obj = raw as Record<string, unknown>;

    const x = obj.x;
    const y = obj.y;

    if (typeof x !== "number" || !Number.isFinite(x)) {
        throw new SandboxError(
            "ValueError",
            `plot_series: points[${index}].x must be a finite number`,
        );
    }
    if (typeof y !== "number" || !Number.isFinite(y)) {
        throw new SandboxError(
            "ValueError",
            `plot_series: points[${index}].y must be a finite number`,
        );
    }

    return { x, y };
}

/**
 * Validates the optional kind argument.
 *
 * @param raw - The raw value from opts (may be undefined, null, or a string).
 * @returns "line" or "scatter". Defaults to "line" when omitted.
 */
function validateKind(raw: unknown): SeriesKind {
    if (raw === undefined || raw === null) return "line";
    if (raw !== "line" && raw !== "scatter") {
        throw new SandboxError(
            "ValueError",
            `plot_series: kind must be "line" or "scatter", got ${String(raw)}`,
        );
    }
    return raw;
}

/**
 * Returns the plot_series tool implementation bound to the given context.
 *
 * Path safety and file-writing are fully delegated to makeWriteFile so that
 * all plotting tools share a single auditable path guard.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxWriteBytes - Maximum bytes the SVG file may occupy.
 * @returns An async function callable from Python that renders a line or scatter SVG.
 */
export function makePlotSeries(
    allowedDir: string,
    maxWriteBytes: number,
): (points: unknown, opts?: Record<string, unknown>) => Promise<unknown> {
    // Instantiate once; all path safety lives here.
    const writeFn = makeWriteFile(allowedDir, maxWriteBytes);

    /**
     * Renders a line or scatter SVG from x/y point data and writes it to disk.
     *
     * @param rawPoints - List of point dicts with x and y keys (finite numbers).
     * @param opts - Optional parameters: kind, output_path, xlabel, ylabel, xlim, ylim, title.
     * @returns A dict with path, points_plotted, and a note about the file being write-only.
     */
    return async (
        rawPoints: unknown,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        // --- Validate points ---

        // Monty passes Python dicts as JS Maps; normalise to plain objects.
        const normalised = convertMaps(rawPoints);

        if (!Array.isArray(normalised) || normalised.length === 0) {
            throw new SandboxError(
                "ValueError",
                "plot_series: points must be a non-empty list",
            );
        }

        const points: XYPoint[] = normalised.map((raw, i) =>
            validatePoint(raw, i),
        );

        // --- Validate optional parameters ---

        const kind = validateKind(opts?.kind);
        const xlabel =
            validateLabel(opts?.xlabel, "xlabel", "plot_series") ?? "x";
        const ylabel =
            validateLabel(opts?.ylabel, "ylabel", "plot_series") ?? "y";
        const title = validateLabel(opts?.title, "title", "plot_series");
        const xlim = validateLim(opts?.xlim, "xlim", "plot_series");
        const ylim = validateLim(opts?.ylim, "ylim", "plot_series");

        const xyOptions: XYOptions = { xlabel, ylabel, title };
        if (xlim) xyOptions.xlim = xlim;
        if (ylim) xyOptions.ylim = ylim;

        // --- Determine output path ---

        const rawOutputPath = opts?.output_path;
        let filePath: string;

        if (rawOutputPath === undefined || rawOutputPath === null) {
            filePath = autoOutputPath();
        } else {
            if (typeof rawOutputPath !== "string") {
                throw new SandboxError(
                    "ValueError",
                    "plot_series: output_path must be a string or None",
                );
            }
            // Enforce .svg so OS file associations work and the read_file
            // SVG block cannot be circumvented by naming the file .txt.
            if (!rawOutputPath.toLowerCase().endsWith(".svg")) {
                throw new SandboxError(
                    "ValueError",
                    "plot_series: output_path must end with .svg",
                );
            }
            filePath = rawOutputPath;
        }

        // --- Render SVG ---

        const svgContent = await renderXySvg(points, kind, xyOptions);

        // --- Write file (all path safety delegated to makeWriteFile) ---

        await writeFn(filePath, svgContent);

        return {
            path: filePath,
            points_plotted: points.length,
            note: WRITE_ONLY_NOTE,
        };
    };
}
