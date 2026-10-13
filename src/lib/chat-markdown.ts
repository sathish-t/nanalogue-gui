// Safe, dependency-free Markdown and code rendering for exported chat transcripts.

/** Options supported by the transcript Markdown renderer. */
interface ChatMarkdownOptions {
    /** Converts ordinary paragraph newlines to HTML line breaks. */
    breaks?: boolean;
}

/** Maximum nesting of inline containers, blockquotes, or link delimiters. */
const MAX_CHAT_MARKDOWN_NESTING = 2;

/** Canonical code languages supported by the transcript highlighter. */
type ChatCodeLanguage = "python" | "json" | "plaintext";

/** Python keywords highlighted in assistant code and system-prompt examples. */
const PYTHON_KEYWORDS = new Set([
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "case",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "match",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "try",
    "while",
    "with",
    "yield",
]);

/** Python literal names highlighted separately from keywords. */
const PYTHON_LITERALS = new Set(["False", "None", "True"]);

/** Common Python built-ins used in generated analysis code. */
const PYTHON_BUILT_INS = new Set([
    "bool",
    "dict",
    "enumerate",
    "float",
    "int",
    "len",
    "list",
    "map",
    "max",
    "min",
    "open",
    "print",
    "range",
    "reversed",
    "round",
    "set",
    "sorted",
    "str",
    "sum",
    "tuple",
    "zip",
]);

/** JSON literal names highlighted separately from strings and numbers. */
const JSON_LITERALS = new Set(["false", "null", "true"]);

/** Numeric token scanner shared by the Python and JSON highlighters. */
const CHAT_CODE_NUMBER_PATTERN =
    /(?:0[xX][\dA-Fa-f](?:_?[\dA-Fa-f])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|(?:(?:\d(?:_?\d)*)(?:\.\d(?:_?\d)*)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)/y;

/** Identifier token scanner shared by the Python and JSON highlighters. */
const CHAT_CODE_IDENTIFIER_PATTERN = /[A-Za-z_]\w*/y;

/**
 * Escapes text before it is inserted into transcript HTML.
 *
 * @param text - Untrusted message or code text.
 * @returns HTML-safe text.
 */
function escapeChatHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Maps a Markdown fence label to the small language set used by chat dumps.
 *
 * @param language - Optional language label from the opening fence.
 * @returns A safe canonical language name for an HTML class.
 */
function normalizeChatCodeLanguage(language?: string): ChatCodeLanguage {
    const label = language?.trim().split(/\s+/, 1)[0]?.toLowerCase();
    if (["gyp", "ipython", "py", "python"].includes(label ?? "")) {
        return "python";
    }
    if (label === "json") {
        return "json";
    }
    return "plaintext";
}

/**
 * Finds the end of a quoted Python or JSON string, including its delimiter.
 *
 * @param code - Complete code block text.
 * @param start - Index of the opening quote.
 * @param quote - Single- or double-quote delimiter.
 * @param triple - Whether the delimiter is a Python triple quote.
 * @returns The exclusive end index, or the code length for an unclosed string.
 */
function findQuotedStringEnd(
    code: string,
    start: number,
    quote: string,
    triple: boolean,
): number {
    const delimiter = triple ? quote.repeat(3) : quote;
    let index = start + delimiter.length;
    while (index < code.length) {
        if (code[index] === "\\") {
            index += 2;
        } else if (code.startsWith(delimiter, index)) {
            return index + delimiter.length;
        } else {
            index += 1;
        }
    }
    return code.length;
}

/**
 * Highlights Python or JSON with an escaping-first lexical scanner.
 *
 * @param code - Raw fenced code.
 * @param language - Canonical supported language.
 * @returns Safe HTML containing only highlight.js-compatible span classes.
 */
function highlightChatCode(code: string, language: ChatCodeLanguage): string {
    if (language === "plaintext") {
        return escapeChatHtml(code);
    }

    let html = "";
    let index = 0;
    while (index < code.length) {
        const character = code[index];

        if (language === "python" && character === "#") {
            const end = code.indexOf("\n", index);
            const commentEnd = end === -1 ? code.length : end;
            html += `<span class="hljs-comment">${escapeChatHtml(code.slice(index, commentEnd))}</span>`;
            index = commentEnd;
            continue;
        }

        if (
            (language === "python" &&
                (character === '"' || character === "'")) ||
            (language === "json" && character === '"')
        ) {
            const triple =
                language === "python" &&
                code.startsWith(character.repeat(3), index);
            const end = findQuotedStringEnd(code, index, character, triple);
            html += `<span class="hljs-string">${escapeChatHtml(code.slice(index, end))}</span>`;
            index = end;
            continue;
        }

        CHAT_CODE_NUMBER_PATTERN.lastIndex = index;
        const number = CHAT_CODE_NUMBER_PATTERN.exec(code)?.[0];
        if (number) {
            html += `<span class="hljs-number">${number}</span>`;
            index += number.length;
            continue;
        }

        CHAT_CODE_IDENTIFIER_PATTERN.lastIndex = index;
        const identifier = CHAT_CODE_IDENTIFIER_PATTERN.exec(code)?.[0];
        if (identifier) {
            let cssClass: string | undefined;
            if (
                (language === "python" && PYTHON_LITERALS.has(identifier)) ||
                (language === "json" && JSON_LITERALS.has(identifier))
            ) {
                cssClass = "hljs-literal";
            } else if (
                language === "python" &&
                PYTHON_KEYWORDS.has(identifier)
            ) {
                cssClass = "hljs-keyword";
            } else if (
                language === "python" &&
                PYTHON_BUILT_INS.has(identifier)
            ) {
                cssClass = "hljs-built_in";
            }
            html += cssClass
                ? `<span class="${cssClass}">${identifier}</span>`
                : identifier;
            index += identifier.length;
            continue;
        }

        html += escapeChatHtml(character);
        index += 1;
    }
    return html;
}

/**
 * Renders a safe fenced or synthetic code block for a chat transcript.
 *
 * @param code - Raw code block text.
 * @param language - Optional Markdown fence language.
 * @returns A pre/code HTML block with Python, JSON, or plaintext content.
 */
export function renderChatCodeBlock(code: string, language?: string): string {
    const normalizedLanguage = normalizeChatCodeLanguage(language);
    const highlighted = highlightChatCode(code, normalizedLanguage);
    return `<pre><code class="hljs language-${normalizedLanguage}">${highlighted}</code></pre>`;
}

/**
 * Scans a link label or destination once, rejecting more than two nested pairs.
 * Escaped delimiters do not contribute to nesting. The caller consumes the
 * scanned candidate or throws; it must not retry at each opening delimiter.
 *
 * @param text - Complete inline Markdown text.
 * @param start - Index of the opening delimiter.
 * @param opening - Opening bracket or parenthesis.
 * @param closing - Corresponding closing delimiter.
 * @param codeRuns - Code spans protected inside labels, but not destinations.
 * @returns Closing-delimiter index, or -1 when the candidate is unclosed.
 */
function findChatMarkdownDelimiterEnd(
    text: string,
    start: number,
    opening: string,
    closing: string,
    codeRuns?: Map<number, ChatMarkdownCodeRun>,
): number {
    let nesting = 1;
    for (let index = start + 1; index < text.length; index += 1) {
        const run = codeRuns?.get(index);
        if (text[index] === "\\") {
            index += 1;
        } else if (run) {
            index = (run.end === -1 ? index : run.end) + run.length - 1;
        } else if (text[index] === opening) {
            nesting += 1;
            if (nesting > MAX_CHAT_MARKDOWN_NESTING) {
                throw new Error(
                    "Chat Markdown parsing error: link nesting exceeds 2 levels.",
                );
            }
        } else if (text[index] === closing) {
            nesting -= 1;
            if (nesting === 0) {
                return index;
            }
        }
    }
    return -1;
}

/** A backtick opener and the next complete run of the same length. */
interface ChatMarkdownCodeRun {
    /** Number of backticks in the opening and closing runs. */
    length: number;
    /** Closing run's start, or -1 when no matching run follows. */
    end: number;
}

/**
 * Indexes code-span boundaries once so unmatched runs never rescan the tail.
 * Backslashes inside code are literal, so even escaped runs can close code.
 *
 * @param text - Inline Markdown source.
 * @returns Opening positions mapped to run lengths and matching closing positions.
 */
function indexChatMarkdownCodeRuns(
    text: string,
): Map<number, ChatMarkdownCodeRun> {
    const runs = [...text.matchAll(/`+/g)];
    const nextByLength = new Map<number, number>();
    const codeRuns = new Map<number, ChatMarkdownCodeRun>();
    for (let index = runs.length - 1; index >= 0; index -= 1) {
        const run = runs[index];
        const length = run[0].length;
        codeRuns.set(run.index, {
            length,
            end: nextByLength.get(length) ?? -1,
        });
        if (length > 1 && text[run.index - 1] === "\\") {
            // Escaping the first backtick leaves the remaining run as an opener.
            codeRuns.set(run.index + 1, {
                length: length - 1,
                end: nextByLength.get(length - 1) ?? -1,
            });
        }
        nextByLength.set(length, run.index);
    }
    return codeRuns;
}

/**
 * Shares link boundaries between rendering and outer formatting lookahead.
 * A non-link bracketed candidate remains literal; its end still advances parsing.
 *
 * @param text - Inline Markdown source.
 * @param start - Opening bracket position, after any image exclamation mark.
 * @param codeRuns - Indexed code spans protecting label contents.
 * @returns Label close and exclusive candidate end; -1 marks an unclosed label.
 */
function findChatMarkdownLink(
    text: string,
    start: number,
    codeRuns: Map<number, ChatMarkdownCodeRun>,
): {
    /** Closing label bracket, or -1 for an unclosed label. */
    labelEnd: number;
    /** Exclusive end of the link or literal bracketed candidate. */
    end: number;
} {
    const labelEnd = findChatMarkdownDelimiterEnd(
        text,
        start,
        "[",
        "]",
        codeRuns,
    );
    if (labelEnd === -1) return { labelEnd, end: text.length };
    if (text[labelEnd + 1] !== "(") return { labelEnd, end: labelEnd + 1 };
    const urlEnd = findChatMarkdownDelimiterEnd(text, labelEnd + 1, "(", ")");
    if (urlEnd === -1) {
        throw new Error(
            "Chat Markdown parsing error: unclosed link destination.",
        );
    }
    return { labelEnd, end: urlEnd + 1 };
}

/**
 * Finds a formatting close, protecting code and links and tracking nested markers.
 *
 * @param text - Inline Markdown source.
 * @param start - First position after the opening formatting marker.
 * @param delimiter - Supported bold, italic, or deletion marker.
 * @param codeRuns - Indexed code-span boundaries for this source.
 * @returns Closing marker's start, or -1 when no unprotected marker follows.
 */
function findChatMarkdownFormatEnd(
    text: string,
    start: number,
    delimiter: string,
    codeRuns: Map<number, ChatMarkdownCodeRun>,
): number {
    const markers = [delimiter];
    let index = start;
    while (index < text.length) {
        const codeRun = codeRuns.get(index);
        if (text[index] === "\\") {
            index += 2;
        } else if (codeRun) {
            index =
                codeRun.end === -1
                    ? index + codeRun.length
                    : codeRun.end + codeRun.length;
        } else if (text[index] === "[") {
            index = findChatMarkdownLink(text, index, codeRuns).end;
        } else {
            const top = markers[markers.length - 1];
            // A double star opens bold inside italics, except when *** closes both.
            const opensBold =
                top === "*" &&
                text.startsWith("**", index) &&
                !(
                    markers[markers.length - 2] === "**" &&
                    text.startsWith("***", index)
                );
            if (!opensBold && text.startsWith(top, index)) {
                markers.pop();
                if (markers.length === 0) return index;
                index += top.length;
                continue;
            }
            const marker = text.startsWith("**", index)
                ? "**"
                : text.startsWith("~~", index)
                  ? "~~"
                  : text[index] === "*"
                    ? "*"
                    : "";
            if (marker) {
                markers.push(marker);
                if (markers.length > MAX_CHAT_MARKDOWN_NESTING) {
                    throw new Error(
                        "Chat Markdown parsing error: inline nesting exceeds 2 levels.",
                    );
                }
                index += marker.length;
            } else {
                index += 1;
            }
        }
    }
    return -1;
}

/**
 * Renders safe inline Markdown without emitting links, images, or raw HTML.
 *
 * @param text - Raw inline Markdown.
 * @param depth - Number of enclosing inline formatting or link containers.
 * @returns HTML containing only fixed formatting elements and escaped text.
 */
function renderInlineChatMarkdown(text: string, depth = 0): string {
    if (depth > MAX_CHAT_MARKDOWN_NESTING) {
        throw new Error(
            "Chat Markdown parsing error: inline nesting exceeds 2 levels.",
        );
    }
    const codeRuns = indexChatMarkdownCodeRuns(text);
    let html = "";
    let index = 0;
    while (index < text.length) {
        if (
            text[index] === "\\" &&
            index + 1 < text.length &&
            "\\`*~[]()!|#>+-.".includes(text[index + 1])
        ) {
            html += escapeChatHtml(text[index + 1]);
            index += 2;
            continue;
        }

        const image = text.startsWith("![", index);
        if (image || text[index] === "[") {
            const labelStart = index + (image ? 2 : 1);
            const { labelEnd, end } = findChatMarkdownLink(
                text,
                labelStart - 1,
                codeRuns,
            );
            if (labelEnd === -1 || text[labelEnd + 1] !== "(") {
                html += escapeChatHtml(text.slice(index, end));
            } else {
                html += renderInlineChatMarkdown(
                    text.slice(labelStart, labelEnd),
                    depth + 1,
                );
            }
            index = end;
            continue;
        }

        const codeRun = codeRuns.get(index);
        if (codeRun) {
            const { length, end } = codeRun;
            if (end !== -1) {
                html += `<code>${escapeChatHtml(text.slice(index + length, end))}</code>`;
                index = end + length;
            } else {
                html += text.slice(index, index + length);
                index += length;
            }
            continue;
        }

        const formats: ReadonlyArray<
            readonly [delimiter: string, element: "del" | "em" | "strong"]
        > = [
            ["**", "strong"],
            ["~~", "del"],
            ["*", "em"],
        ];
        let matchedFormat = false;
        for (const [delimiter, element] of formats) {
            if (!text.startsWith(delimiter, index)) {
                continue;
            }
            const end = findChatMarkdownFormatEnd(
                text,
                index + delimiter.length,
                delimiter,
                codeRuns,
            );
            if (end <= index + delimiter.length) {
                continue;
            }
            const inner = renderInlineChatMarkdown(
                text.slice(index + delimiter.length, end),
                depth + 1,
            );
            html += `<${element}>${inner}</${element}>`;
            index = end + delimiter.length;
            matchedFormat = true;
            break;
        }
        if (matchedFormat) {
            continue;
        }

        html += escapeChatHtml(text[index]);
        index += 1;
    }
    return html;
}

/**
 * Splits a Markdown table row at unescaped pipes, preserving escapes for inline rendering.
 *
 * @param line - Raw table row.
 * @returns Cell text without optional outer pipes.
 */
function splitMarkdownTableRow(line: string): string[] {
    const trimmed = line.trim();
    const cells: string[] = [];
    let start = trimmed.startsWith("|") ? 1 : 0;
    for (let index = start; index < trimmed.length; index += 1) {
        if (trimmed[index] === "\\") {
            // Skip escaped characters, including paired backslashes before a pipe.
            index += 1;
        } else if (trimmed[index] === "|") {
            cells.push(trimmed.slice(start, index).trim());
            start = index + 1;
        }
    }
    if (start < trimmed.length || !trimmed.endsWith("|")) {
        cells.push(trimmed.slice(start).trim());
    }
    return cells;
}

/**
 * Checks whether a line is a valid separator beneath a Markdown table header.
 *
 * @param line - Candidate separator row.
 * @returns True when every cell contains a GFM-style dash separator.
 */
function isMarkdownTableSeparator(line: string): boolean {
    const cells = splitMarkdownTableRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * Checks whether a source line begins a supported block construct.
 *
 * @param lines - All normalized Markdown lines.
 * @param index - Candidate line index.
 * @returns True for fences, headings, lists, quotes, rules, code, or tables.
 */
function isChatMarkdownBlockStart(lines: string[], index: number): boolean {
    const line = lines[index] ?? "";
    if (
        /^ {0,3}(?:`{3,}|~{3,})/.test(line) ||
        /^ {0,3}#{1,6}(?:\s|$)/.test(line) ||
        /^ {0,3}> ?/.test(line) ||
        /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line) ||
        /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line) ||
        /^ {4}\S/.test(line)
    ) {
        return true;
    }
    return (
        line.includes("|") &&
        index + 1 < lines.length &&
        isMarkdownTableSeparator(lines[index + 1])
    );
}

/**
 * Checks for a closing fence with at most three leading spaces and matching markers.
 *
 * @param line - Candidate closing line.
 * @param marker - Opening backtick or tilde run.
 * @returns True when the line closes the opening fence.
 */
function closesMarkdownFence(line: string, marker: string): boolean {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    return (
        fence !== null &&
        fence[1].length >= marker.length &&
        fence[1][0] === marker[0]
    );
}

/**
 * Renders the Markdown subset used by system prompts and chat messages.
 * Raw HTML is always escaped, while link and image destinations are discarded.
 * Rejects excessive nesting, unclosed link destinations, and stalled parsing.
 *
 * @param markdown - Untrusted message content.
 * @param options - Optional line-break behavior for human messages.
 * @returns Safe transcript body HTML.
 */
export function renderChatMarkdown(
    markdown: string,
    options: ChatMarkdownOptions = {},
): string {
    return renderChatMarkdownBlocks(markdown, options, 0);
}

/**
 * Renders blocks with at most two enclosing blockquotes and a progress guard.
 * Inline nesting is limited separately; code blocks are not parsed as Markdown.
 *
 * @param markdown - Source text at the current blockquote depth.
 * @param options - Line-break behavior for human messages.
 * @param depth - Number of enclosing blockquotes.
 * @returns Safe body HTML, or throws when parsing cannot proceed safely.
 */
function renderChatMarkdownBlocks(
    markdown: string,
    options: ChatMarkdownOptions,
    depth: number,
): string {
    if (depth > MAX_CHAT_MARKDOWN_NESTING) {
        throw new Error(
            "Chat Markdown parsing error: blockquote nesting exceeds 2 levels.",
        );
    }
    // Normalize Unicode line/paragraph separators too, including inside code.
    const lines = markdown.replace(/\r\n?|[\u2028\u2029]/g, "\n").split("\n");
    const blocks: string[] = [];
    let index = 0;
    let previousIndex = -1;

    while (index < lines.length) {
        if (index <= previousIndex) {
            throw new Error(
                `Chat Markdown parsing error: no progress at line ${index + 1}.`,
            );
        }
        previousIndex = index;
        const line = lines[index];
        if (line.trim() === "") {
            index += 1;
            continue;
        }

        const fence = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
        if (fence) {
            const codeLines: string[] = [];
            index += 1;
            while (
                index < lines.length &&
                !closesMarkdownFence(lines[index], fence[1])
            ) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) {
                index += 1;
            }
            blocks.push(renderChatCodeBlock(codeLines.join("\n"), fence[2]));
            continue;
        }

        const heading = line.match(/^ {0,3}(#{1,6})(?:\s+|$)(.*)$/);
        if (heading) {
            const level = heading[1].length;
            const content = heading[2].replace(/\s+#+\s*$/, "");
            blocks.push(
                `<h${level}>${renderInlineChatMarkdown(content)}</h${level}>`,
            );
            index += 1;
            continue;
        }

        if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
            blocks.push("<hr>");
            index += 1;
            continue;
        }

        if (
            line.includes("|") &&
            index + 1 < lines.length &&
            isMarkdownTableSeparator(lines[index + 1])
        ) {
            const headers = splitMarkdownTableRow(line);
            index += 2;
            const rows: string[][] = [];
            while (
                index < lines.length &&
                lines[index].trim() !== "" &&
                lines[index].includes("|")
            ) {
                const cells = splitMarkdownTableRow(lines[index]);
                if (cells.length > headers.length) {
                    throw new Error(
                        `Chat Markdown parsing error: too many table cells at line ${index + 1}.`,
                    );
                }
                rows.push(cells);
                index += 1;
            }
            const headerHtml = headers
                .map((cell) => `<th>${renderInlineChatMarkdown(cell)}</th>`)
                .join("");
            const rowsHtml = rows
                .map(
                    (row) =>
                        `<tr>${headers
                            .map(
                                (_header, column) =>
                                    `<td>${renderInlineChatMarkdown(row[column] ?? "")}</td>`,
                            )
                            .join("")}</tr>`,
                )
                .join("\n");
            blocks.push(
                `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`,
            );
            continue;
        }

        const listItem = line.match(/^ {0,3}((?:[-+*])|(?:\d+[.)]))\s+(.*)$/);
        if (listItem) {
            const ordered = /^\d/.test(listItem[1]);
            const items: string[] = [];
            while (index < lines.length) {
                const item = lines[index].match(
                    /^ {0,3}((?:[-+*])|(?:\d+[.)]))\s+(.*)$/,
                );
                if (!item || /^\d/.test(item[1]) !== ordered) {
                    break;
                }
                items.push(`<li>${renderInlineChatMarkdown(item[2])}</li>`);
                index += 1;
            }
            const element = ordered ? "ol" : "ul";
            blocks.push(`<${element}>${items.join("")}</${element}>`);
            continue;
        }

        if (/^ {0,3}> ?/.test(line)) {
            const quoteLines: string[] = [];
            while (index < lines.length && /^ {0,3}> ?/.test(lines[index])) {
                quoteLines.push(lines[index].replace(/^ {0,3}> ?/, ""));
                index += 1;
            }
            blocks.push(
                `<blockquote>${renderChatMarkdownBlocks(quoteLines.join("\n"), options, depth + 1)}</blockquote>`,
            );
            continue;
        }

        if (/^ {4}\S/.test(line)) {
            const codeLines: string[] = [];
            while (index < lines.length && /^ {4}/.test(lines[index])) {
                codeLines.push(lines[index].slice(4));
                index += 1;
            }
            blocks.push(renderChatCodeBlock(codeLines.join("\n")));
            continue;
        }

        const paragraphLines: string[] = [];
        while (
            index < lines.length &&
            lines[index].trim() !== "" &&
            !isChatMarkdownBlockStart(lines, index)
        ) {
            paragraphLines.push(renderInlineChatMarkdown(lines[index]));
            index += 1;
        }
        const separator = options.breaks ? "<br>\n" : "\n";
        blocks.push(`<p>${paragraphLines.join(separator)}</p>`);
    }

    return blocks.join("\n");
}
