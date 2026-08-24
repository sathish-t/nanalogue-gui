// Dependency-free SVG primitives shared by histogram and x/y plot renderers.

/** Numeric domain mapped onto one plot axis. */
export type PlotValueDomain = readonly [number, number];

/** Coordinates and scale functions supplied while rendering plot marks. */
export interface SvgPlotLayout {
    /** Width of the drawable plot area in pixels. */
    plotWidth: number;
    /** Height of the drawable plot area in pixels. */
    plotHeight: number;
    /** Maps an x-axis data value to a plot-area pixel coordinate. */
    scaleX(value: number): number;
    /** Maps a y-axis data value to a plot-area pixel coordinate. */
    scaleY(value: number): number;
    /** Formats a plot-area pixel coordinate for an SVG attribute. */
    formatCoordinate(value: number): string;
}

/** Options describing the common frame around SVG plot marks. */
export interface SvgPlotFrameOptions {
    /** Short chart name exposed to screen readers when no visible title exists. */
    accessibleTitle: string;
    /** Screen-reader description of the represented data. */
    description: string;
    /** Label rendered below the x-axis. */
    xlabel: string;
    /** Label rendered to the left of the y-axis. */
    ylabel: string;
    /** Optional visible chart title. */
    title?: string;
    /** Data domain mapped across the x-axis. */
    xDomain: PlotValueDomain;
    /** Data domain mapped across the y-axis. */
    yDomain: PlotValueDomain;
    /** Whether to extend the x-axis domain to rounded tick boundaries. */
    niceX?: boolean;
    /** Whether to extend the y-axis domain to rounded tick boundaries. */
    niceY?: boolean;
}

/** Plot-area width in pixels, matching the former Vega-backed renderers. */
const PLOT_WIDTH = 600;
/** Plot-area height in pixels, matching the former Vega-backed renderers. */
const PLOT_HEIGHT = 370;
/** Space reserved to the left of the plot for y-axis labels. */
const LEFT_MARGIN = 64;
/** Space reserved to the right of the plot. */
const RIGHT_MARGIN = 20;
/** Space above an untitled plot. */
const TOP_MARGIN = 18;
/** Additional space above a plot with a visible title. */
const TITLE_MARGIN = 26;
/** Space below the plot for x-axis labels. */
const BOTTOM_MARGIN = 58;
/** Desired number of x-axis intervals. */
const X_TICK_COUNT = 10;
/** Desired number of y-axis intervals. */
const Y_TICK_COUNT = 8;

/**
 * Finds a finite data extent and expands a single-value extent for plotting.
 *
 * @param values - Non-empty finite values to inspect.
 * @param includeZero - Whether the returned domain must include zero.
 * @returns An increasing [minimum, maximum] plot domain.
 */
export function findPlotValueExtent(
    values: readonly number[],
    includeZero = false,
): [number, number] {
    let minimum = values[0];
    let maximum = values[0];
    for (let index = 1; index < values.length; index += 1) {
        minimum = Math.min(minimum, values[index]);
        maximum = Math.max(maximum, values[index]);
    }

    if (includeZero) {
        minimum = Math.min(0, minimum);
        maximum = Math.max(0, maximum);
    }

    if (minimum === maximum) {
        if (minimum === 0) return includeZero ? [0, 1] : [-1, 1];
        const padding = Math.max(Math.abs(minimum) * 0.05, Number.MIN_VALUE);
        const paddedMinimum = minimum - padding;
        const paddedMaximum = maximum + padding;
        return [
            Number.isFinite(paddedMinimum) ? paddedMinimum : minimum,
            Number.isFinite(paddedMaximum) ? paddedMaximum : maximum,
        ];
    }

    return [minimum, maximum];
}

/**
 * Escapes untrusted text before placing it in SVG text or attributes.
 *
 * @param value - Untrusted text to escape.
 * @returns Text with XML-significant characters replaced by entities.
 */
function escapeSvgText(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

/**
 * Formats calculated pixel coordinates without long floating-point tails.
 *
 * @param value - Calculated pixel coordinate.
 * @returns A compact decimal suitable for an SVG numeric attribute.
 */
function formatSvgCoordinate(value: number): string {
    const rounded = Math.abs(value) < 0.0005 ? 0 : value;
    return Number(rounded.toFixed(3)).toString();
}

/**
 * Formats an axis tick in ordinary or scientific notation as appropriate.
 *
 * @param value - Numeric tick value to display.
 * @returns A compact human-readable tick label.
 */
function formatTickValue(value: number): string {
    const normalized = Math.abs(value) < Number.EPSILON ? 0 : value;
    const magnitude = Math.abs(normalized);
    if (magnitude >= 1_000_000 || (magnitude > 0 && magnitude < 0.001)) {
        return normalized.toExponential(2);
    }
    return Number(normalized.toPrecision(12)).toString();
}

/**
 * Chooses a human-readable tick step for a numeric domain.
 *
 * @param domain - Increasing numeric domain for one axis.
 * @param count - Desired number of tick intervals.
 * @returns A rounded positive step, or infinity for an overflowing domain.
 */
function calculateTickStep(domain: PlotValueDomain, count: number): number {
    const span = domain[1] - domain[0];
    if (!Number.isFinite(span)) return Number.POSITIVE_INFINITY;

    const roughStep = span / count;
    if (roughStep === 0) return span;
    const power = Math.floor(Math.log10(roughStep));
    const magnitude = 10 ** power;
    if (magnitude === 0) return span;
    const error = roughStep / magnitude;
    const factor =
        error >= Math.sqrt(50)
            ? 10
            : error >= Math.sqrt(10)
              ? 5
              : error >= Math.sqrt(2)
                ? 2
                : 1;
    return factor * magnitude;
}

/**
 * Extends a numeric domain to rounded tick boundaries.
 *
 * @param domain - Increasing numeric domain for one axis.
 * @param count - Desired number of tick intervals.
 * @returns The domain expanded to multiples of its calculated tick step.
 */
function makeNiceDomain(
    domain: PlotValueDomain,
    count: number,
): PlotValueDomain {
    const step = calculateTickStep(domain, count);
    if (!Number.isFinite(step)) return domain;
    const niceMinimum = Math.floor(domain[0] / step) * step;
    const niceMaximum = Math.ceil(domain[1] / step) * step;
    return [
        Number.isFinite(niceMinimum) ? niceMinimum : domain[0],
        Number.isFinite(niceMaximum) ? niceMaximum : domain[1],
    ];
}

/**
 * Produces stable tick values within a numeric domain.
 *
 * @param domain - Increasing numeric domain for one axis.
 * @param count - Desired number of tick intervals.
 * @returns Rounded numeric tick values contained by the domain.
 */
function createTickValues(domain: PlotValueDomain, count: number): number[] {
    const step = calculateTickStep(domain, count);
    if (!Number.isFinite(step)) return [domain[0], domain[1]];

    const first = Math.ceil(domain[0] / step) * step;
    const last = Math.floor(domain[1] / step) * step;
    const tickValues: number[] = [];
    const maximumTickCount = count * 2 + 2;
    for (
        let value = first;
        value <= last + step * 1e-9 && tickValues.length < maximumTickCount;
        value += step
    ) {
        tickValues.push(Number(value.toPrecision(14)));
    }
    return tickValues;
}

/**
 * Creates a stable linear mapping, including domains whose span overflows.
 *
 * @param domain - Increasing numeric input domain.
 * @param rangeStart - Output coordinate corresponding to the domain minimum.
 * @param rangeEnd - Output coordinate corresponding to the domain maximum.
 * @returns A function that maps a domain value to its linear output coordinate.
 */
function createLinearScale(
    domain: PlotValueDomain,
    rangeStart: number,
    rangeEnd: number,
): (value: number) => number {
    const span = domain[1] - domain[0];
    const domainFraction = Number.isFinite(span)
        ? (value: number): number => (value - domain[0]) / span
        : (value: number): number =>
              (value / 2 - domain[0] / 2) / (domain[1] / 2 - domain[0] / 2);
    return (value: number): number =>
        rangeStart + domainFraction(value) * (rangeEnd - rangeStart);
}

/**
 * Renders vertical grid lines, x-axis ticks, and x-axis labels.
 *
 * @param tickValues - Numeric values to mark along the x-axis.
 * @param scaleX - Function mapping data values to horizontal coordinates.
 * @param xlabel - Escaped-at-render-time x-axis title.
 * @returns SVG elements forming the complete x-axis.
 */
function renderXAxis(
    tickValues: readonly number[],
    scaleX: (value: number) => number,
    xlabel: string,
): string {
    const ticks = tickValues
        .map((value) => {
            const x = formatSvgCoordinate(scaleX(value));
            return `    <line x1="${x}" y1="0" x2="${x}" y2="${PLOT_HEIGHT}" stroke="#e5e7eb"/>
    <line x1="${x}" y1="${PLOT_HEIGHT}" x2="${x}" y2="${PLOT_HEIGHT + 5}" stroke="#4b5563"/>
    <text x="${x}" y="${PLOT_HEIGHT + 20}" text-anchor="middle" font-size="12" fill="#374151">${escapeSvgText(formatTickValue(value))}</text>`;
        })
        .join("\n");

    return `${ticks}
    <line x1="0" y1="${PLOT_HEIGHT}" x2="${PLOT_WIDTH}" y2="${PLOT_HEIGHT}" stroke="#4b5563"/>
    <text x="${PLOT_WIDTH / 2}" y="${PLOT_HEIGHT + 46}" text-anchor="middle" font-size="14" fill="#111827">${escapeSvgText(xlabel)}</text>`;
}

/**
 * Renders horizontal grid lines, y-axis ticks, and y-axis labels.
 *
 * @param tickValues - Numeric values to mark along the y-axis.
 * @param scaleY - Function mapping data values to vertical coordinates.
 * @param ylabel - Escaped-at-render-time y-axis title.
 * @returns SVG elements forming the complete y-axis.
 */
function renderYAxis(
    tickValues: readonly number[],
    scaleY: (value: number) => number,
    ylabel: string,
): string {
    const ticks = tickValues
        .map((value) => {
            const y = formatSvgCoordinate(scaleY(value));
            return `    <line x1="0" y1="${y}" x2="${PLOT_WIDTH}" y2="${y}" stroke="#e5e7eb"/>
    <line x1="-5" y1="${y}" x2="0" y2="${y}" stroke="#4b5563"/>
    <text x="-9" y="${y}" dy="0.32em" text-anchor="end" font-size="12" fill="#374151">${escapeSvgText(formatTickValue(value))}</text>`;
        })
        .join("\n");

    return `${ticks}
    <line x1="0" y1="0" x2="0" y2="${PLOT_HEIGHT}" stroke="#4b5563"/>
    <text transform="translate(-48 ${PLOT_HEIGHT / 2}) rotate(-90)" text-anchor="middle" font-size="14" fill="#111827">${escapeSvgText(ylabel)}</text>`;
}

/**
 * Renders a complete, dependency-free SVG plot around caller-provided marks.
 *
 * @param options - Labels, domains, title, and accessibility text for the frame.
 * @param renderMarks - Produces SVG marks using the calculated plot layout.
 * @returns A complete standalone SVG document string.
 */
export function renderSvgPlot(
    options: SvgPlotFrameOptions,
    renderMarks: (layout: SvgPlotLayout) => string,
): string {
    const topMargin = TOP_MARGIN + (options.title ? TITLE_MARGIN : 0);
    const width = LEFT_MARGIN + PLOT_WIDTH + RIGHT_MARGIN;
    const height = topMargin + PLOT_HEIGHT + BOTTOM_MARGIN;
    const xDomain = options.niceX
        ? makeNiceDomain(options.xDomain, X_TICK_COUNT)
        : options.xDomain;
    const yDomain = options.niceY
        ? makeNiceDomain(options.yDomain, Y_TICK_COUNT)
        : options.yDomain;
    const scaleX = createLinearScale(xDomain, 0, PLOT_WIDTH);
    const scaleY = createLinearScale(yDomain, PLOT_HEIGHT, 0);
    const layout: SvgPlotLayout = {
        plotWidth: PLOT_WIDTH,
        plotHeight: PLOT_HEIGHT,
        scaleX,
        scaleY,
        formatCoordinate: formatSvgCoordinate,
    };
    const xAxis = renderXAxis(
        createTickValues(xDomain, X_TICK_COUNT),
        scaleX,
        options.xlabel,
    );
    const yAxis = renderYAxis(
        createTickValues(yDomain, Y_TICK_COUNT),
        scaleY,
        options.ylabel,
    );
    const visibleTitle = options.title
        ? `  <text x="${width / 2}" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="#111827">${escapeSvgText(options.title)}</text>\n`
        : "";

    // Standalone SVG document; all untrusted labels are escaped before insertion.
    return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" role="img" aria-labelledby="plot-title plot-description" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title id="plot-title">${escapeSvgText(options.title || options.accessibleTitle)}</title>
  <desc id="plot-description">${escapeSvgText(options.description)}</desc>
  <rect width="${width}" height="${height}" fill="white"/>
${visibleTitle}  <g transform="translate(${LEFT_MARGIN} ${topMargin})" font-family="system-ui, sans-serif">
${xAxis}
${yAxis}
    <defs><clipPath id="plot-clip"><rect width="${PLOT_WIDTH}" height="${PLOT_HEIGHT}"/></clipPath></defs>
    <g clip-path="url(#plot-clip)">
${renderMarks(layout)}
    </g>
  </g>
</svg>`;
}
