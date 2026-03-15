// External tool: plot_series
// Renders x/y point data as a line or scatter SVG file written to the
// sandboxed directory. All path safety and file-writing is delegated to
// makeWriteFile so that every plotting tool goes through a single,
// auditable path guard rather than each replicating the logic.

import { randomUUID } from "node:crypto";
import { AI_CHAT_OUTPUT_DIR } from "../ai-chat-constants";
import { convertMaps, SandboxError } from "../monty-sandbox-helpers";
import type { XYPoint } from "../stats";
import type { SeriesKind, XYOptions } from "../xy-renderer";
import { renderXySvg } from "../xy-renderer";
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
            `plot_series: ${name} must be [min, max] with min < max`,
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
            `plot_series: ${name} must be a string`,
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
        const xlabel = validateLabel(opts?.xlabel, "xlabel") ?? "x";
        const ylabel = validateLabel(opts?.ylabel, "ylabel") ?? "y";
        const title = validateLabel(opts?.title, "title");
        const xlim = validateLim(opts?.xlim, "xlim");
        const ylim = validateLim(opts?.ylim, "ylim");

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
