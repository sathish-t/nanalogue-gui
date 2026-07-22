// Converts LLM message arrays into self-contained HTML files for session review.

/**
 * Converts an array of LLM messages into a self-contained HTML file for
 * human review. Used by the /dump_llm_instructions slash command and the
 * --dump-llm-instructions CLI flag.
 *
 * All rendering (markdown, syntax highlighting) is done at generation time
 * using marked and highlight.js. The output HTML contains only a small inline
 * script for the copy button; no external JavaScript dependencies.
 */

import hljs from "highlight.js";
import { marked, Renderer } from "marked";
import type { LlmMessage } from "./chat-orchestrator.js";
import { COPY_JS, HLJS_THEME_CSS, PAGE_CSS } from "./log-to-html-assets.js";

// ---------------------------------------------------------------------------
// marked configuration — highlight code fences with highlight.js
// ---------------------------------------------------------------------------

/**
 * Renders a fenced code block token using highlight.js for syntax highlighting.
 * Assigned to the marked Renderer in buildMarkedRenderer.
 *
 * @param token - The code token provided by marked.
 * @param token.text - The raw code text inside the fence.
 * @param token.lang - The language identifier from the opening fence, if any.
 * @param token.escaped - Unused flag passed by marked; included for type compatibility.
 * @returns An HTML string with a highlighted pre/code block.
 */
function renderCodeBlock({
    text,
    lang,
}: {
    /** The raw code text inside the fence. */
    text: string;
    /** The language identifier from the opening fence, if any. */
    lang?: string;
    /** Unused flag passed by marked; included for type compatibility. */
    escaped?: boolean;
}): string {
    const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
    const highlighted = hljs.highlight(text, { language }).value;
    return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
}

/**
 * Renderer for markdown link tokens. LLM messages in this context are Python
 * code and plain-text prompts — clickable links add no value and introduce an
 * XSS surface (javascript: schemes etc.). We therefore render the visible link
 * text only, discarding the URL entirely.
 *
 * @param token - The link token provided by marked.
 * @param token.text - The link label (already rendered inner HTML).
 * @param token.href - Discarded; not used.
 * @param token.title - Discarded; not used.
 * @returns The link label as plain inline HTML with no anchor element.
 */
function renderLink({
    text,
}: {
    /** The link label (already rendered inner HTML). */
    text: string;
    /** Discarded; not used. */
    href?: string;
    /** Discarded; not used. */
    title?: string | null;
}): string {
    return text;
}

/**
 * Renderer for raw HTML tokens produced by marked. Escapes the text rather
 * than passing it through, preventing any script or tag injection from message
 * content that happens to contain literal HTML.
 *
 * @param token - The HTML token provided by marked.
 * @param token.text - The raw HTML text to escape.
 * @returns The HTML-escaped text, safe for inclusion in the output document.
 */
function renderRawHtml({
    text,
}: {
    /** The raw HTML text to escape. */
    text: string;
}): string {
    return escapeHtml(text);
}

/**
 * Renderer for markdown image tokens. Images are stripped to their alt text
 * only — no <img> element is emitted. This prevents URL fetching, src-based
 * injection (data: URIs, remote tracking pixels, etc.) and keeps the output
 * fully self-contained.
 *
 * @param token - The image token provided by marked.
 * @param token.text - The image alt text (already rendered inner HTML).
 * @param token.href - Discarded; not used.
 * @param token.title - Discarded; not used.
 * @returns The alt text as plain inline HTML with no img element.
 */
function renderImage({
    text,
}: {
    /** The image alt text (already rendered inner HTML). */
    text: string;
    /** Discarded; not used. */
    href?: string;
    /** Discarded; not used. */
    title?: string | null;
}): string {
    return text;
}

/**
 * Builds and returns a configured marked Renderer that uses highlight.js for
 * fenced code blocks and escapes raw HTML to prevent injection. Created once
 * per generateChatHtml call so the module stays side-effect-free at import
 * time.
 *
 * @returns A marked Renderer with syntax-highlighted code block support,
 *   raw-HTML escaping, link stripping, and image stripping.
 */
function buildMarkedRenderer(): Renderer {
    const renderer = new Renderer();
    renderer.code = renderCodeBlock;
    /* Escape raw HTML tokens instead of passing them through. Without this,
       marked preserves literal <script> tags and similar constructs from the
       input, which would execute when the user opens the generated HTML file. */
    renderer.html = renderRawHtml;
    /* Strip markdown links to their visible text only — no <a> element.
       Eliminates javascript: injection and keeps the dump non-interactive. */
    renderer.link = renderLink;
    /* Strip markdown images to their alt text only — no <img> element.
       Prevents URL fetching, data: URIs, and remote tracking pixels. */
    renderer.image = renderImage;
    return renderer;
}

// ---------------------------------------------------------------------------
// Execution-result message rendering
// ---------------------------------------------------------------------------

/** Shape of the JSON payload inside a "Code execution result: ..." message. */
interface ExecResultPayload {
    /** Whether the code execution succeeded. */
    success?: boolean;
    /** The bare-expression value returned by the sandbox. */
    value?: unknown;
    /** True when the value was truncated due to size limits. */
    value_truncated?: boolean;
    /** Concatenated print() output from the sandbox. */
    prints?: string;
    /** True when print output was truncated due to size limits. */
    truncated?: boolean;
    /** Error class name on failure (e.g. "SyntaxError"). */
    error_type?: string;
    /** Human-readable error message on failure. */
    message?: string;
    /** True when the sandbox hit its time limit. */
    is_timeout?: boolean;
    /** How many execution rounds the model has remaining. */
    rounds_remaining?: number;
    /** Optional hint injected by the orchestrator to guide the model. */
    hint?: string;
}

/**
 * Renders the HTML for a "Code execution result: {json}" user message.
 * Parses the JSON and produces a structured block showing success/failure,
 * prints, value, rounds remaining, and error details.
 *
 * @param content - The full content string of the user message.
 * @returns HTML string for the execution result card.
 */
function renderExecResult(content: string): string {
    const jsonStr = content.slice("Code execution result:".length).trim();
    let payload: ExecResultPayload | null = null;
    try {
        payload = JSON.parse(jsonStr) as ExecResultPayload;
    } catch {
        /* If JSON is malformed, fall back to showing raw content. */
    }
    if (payload === null) {
        const escaped = escapeHtml(content);
        return `<div class="message message-exec message-exec-error">
  <!-- execution result header -->
  <div class="message-header"><span>⚠ Code execution result</span></div>
  <!-- raw fallback body -->
  <div class="message-body"><pre class="exec-error-detail">${escaped}</pre></div>
</div>`;
    }

    const ok = payload.success !== false;
    const statusIcon = ok ? "✓" : "✗";
    const rounds =
        payload.rounds_remaining !== undefined
            ? `<span class="rounds-badge">${payload.rounds_remaining} round${payload.rounds_remaining === 1 ? "" : "s"} left</span>`
            : "";

    const bodyParts: string[] = [];

    /* prints section */
    if (payload.prints) {
        bodyParts.push(
            `<div class="exec-section-label">Output (print)</div>` +
                `<pre class="exec-prints">${escapeHtml(payload.prints)}</pre>`,
        );
    }

    /* value section (success path) */
    if (ok && payload.value !== undefined) {
        const valueStr =
            typeof payload.value === "string"
                ? payload.value
                : JSON.stringify(payload.value, null, 2);
        const truncNote = payload.value_truncated
            ? " <em>(truncated)</em>"
            : payload.truncated
              ? " <em>(output truncated)</em>"
              : "";
        bodyParts.push(
            `<div class="exec-section-label">Value${truncNote}</div>` +
                `<pre class="exec-value">${escapeHtml(valueStr)}</pre>`,
        );
    }

    /* error section (failure path) */
    if (!ok) {
        const errLabel = payload.is_timeout
            ? "Timeout"
            : (payload.error_type ?? "Error");
        const errMsg = payload.message ?? "(no message)";
        bodyParts.push(
            `<div class="exec-section-label">${escapeHtml(errLabel)}</div>` +
                `<pre class="exec-error-detail">${escapeHtml(errMsg)}</pre>`,
        );
        if (payload.prints) {
            /* prints already added above if present */
        }
        if (payload.hint) {
            bodyParts.push(
                `<div class="exec-section-label">Hint</div>` +
                    `<pre class="exec-error-detail">${escapeHtml(payload.hint)}</pre>`,
            );
        }
    }

    const bodyHtml =
        bodyParts.length > 0
            ? `<div class="message-body">${bodyParts.join("\n")}</div>`
            : "";

    return `<div class="message message-exec ${ok ? "message-exec-ok" : "message-exec-error"}">
  <!-- execution result header -->
  <div class="message-header"><span>${statusIcon} Code execution result</span>${rounds}</div>
  ${bodyHtml}
</div>`;
}

// ---------------------------------------------------------------------------
// Per-message renderers
// ---------------------------------------------------------------------------

/**
 * Escapes HTML special characters to prevent injection when embedding raw
 * text content into HTML.
 *
 * @param text - Raw text to escape.
 * @returns HTML-escaped string.
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Renders the system message as a collapsed <details> block. The content is
 * treated as markdown (the system prompt uses headers, code fences, tables).
 *
 * @param content - Raw system prompt text.
 * @param renderer - Pre-built marked Renderer.
 * @returns HTML string.
 */
function renderSystemMessage(content: string, renderer: Renderer): string {
    const lineCount = content.split("\n").length;
    const bodyHtml = marked(content, { renderer }) as string;
    return `<details class="message message-system">
  <!-- system prompt — collapsed by default, expand to inspect -->
  <summary>System prompt · ${lineCount} lines</summary>
  <div class="message-body">${bodyHtml}</div>
</details>`;
}

/**
 * Renders a human user message as a simple bubble with plain text.
 *
 * @param content - The user message text.
 * @param renderer - Pre-built marked Renderer (includes raw-HTML escaping).
 * @returns HTML string.
 */
function renderUserMessage(content: string, renderer: Renderer): string {
    /* Render as markdown in case the user typed something with formatting,
       but keep it simple — most prompts are plain prose. The renderer is
       passed to ensure raw HTML in the content is escaped, not injected. */
    const bodyHtml = marked(content, { renderer, breaks: true }) as string;
    return `<div class="message message-user">
  <!-- human user prompt -->
  <div class="message-header">
    <span>User</span>
    <button class="copy-btn" aria-label="Copy message to clipboard">Copy</button>
  </div>
  <div class="message-body">${bodyHtml}</div>
</div>`;
}

/**
 * Renders an assistant message. The model should respond in pure Python per
 * the system prompt, but may occasionally wrap code in markdown fences (e.g.
 * Older models). We run the content through marked either way: if it is bare
 * Python with no fences, marked treats it as a plain paragraph; if it has
 * fences, they are syntax-highlighted by the custom renderer..
 *
 * @param content - The assistant message text (Python or markdown).
 * @param renderer - Pre-built marked Renderer.
 * @returns HTML string.
 */
function renderAssistantMessage(content: string, renderer: Renderer): string {
    /* If the whole response is bare Python (no markdown fences), wrap it in
       a synthetic code fence so it gets proper syntax highlighting. */
    const hasFence = /^```/m.test(content);
    const mdSource = hasFence ? content : `\`\`\`python\n${content}\n\`\`\``;
    const bodyHtml = marked(mdSource, { renderer }) as string;
    return `<div class="message message-assistant">
  <!-- assistant (LLM) response -->
  <div class="message-header">
    <span>Assistant</span>
    <button class="copy-btn" aria-label="Copy code to clipboard">Copy</button>
  </div>
  <div class="message-body">${bodyHtml}</div>
</div>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts an array of LLM messages into a self-contained HTML string
 * suitable for saving as a .html file alongside the .log dump.
 *
 * Markdown rendering and syntax highlighting are done at call time in
 * TypeScript. The output contains a small inline script only for the
 * copy button; no external JavaScript or network resources are needed.
 *
 * @param messages - The messages array sent to the LLM (same as used for
 *   the .log dump).
 * @param snapshotId - A short identifier shown in the page title and header.
 *   For example, the UUID portion of the dump filename. Note this identifies
 *   a single dump snapshot, not a unique per-session value.
 * @returns A complete, self-contained HTML document as a string.
 */
export function generateChatHtml(
    messages: LlmMessage[],
    snapshotId: string,
): string {
    const renderer = buildMarkedRenderer();

    /* Render each message to HTML. */
    const messagesHtml = messages
        .map((msg) => {
            if (msg.role === "system") {
                return renderSystemMessage(msg.content, renderer);
            }
            if (msg.role === "user") {
                if (msg.content.startsWith("Code execution result:")) {
                    return renderExecResult(msg.content);
                }
                return renderUserMessage(msg.content, renderer);
            }
            if (msg.role === "assistant") {
                return renderAssistantMessage(msg.content, renderer);
            }
            /* Unknown role — render as plain text fallback. */
            return `<div class="message message-user">
  <!-- unknown role: ${escapeHtml(msg.role)} -->
  <div class="message-header">${escapeHtml(msg.role)}</div>
  <div class="message-body"><pre>${escapeHtml(msg.content)}</pre></div>
</div>`;
        })
        .join("\n\n");

    const date = `${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`;
    const msgCount = messages.length;

    /* Assemble the full self-contained HTML document. */
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- nanalogue chat transcript — generated by /dump_llm_instructions -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>nanalogue chat · ${escapeHtml(snapshotId)}</title>
  <!-- page styles -->
  <style>
${PAGE_CSS}
  </style>
  <!-- highlight.js atom-one-dark theme -->
  <style>
${HLJS_THEME_CSS}
  </style>
</head>
<body>
  <!-- page header -->
  <header>
    <h1>nanalogue chat transcript</h1>
    <div class="meta">${escapeHtml(snapshotId)} · ${msgCount} message${msgCount === 1 ? "" : "s"} · generated ${escapeHtml(date)}</div>
  </header>
  <!-- message list -->
  <main>
${messagesHtml}
  </main>
  <!-- copy button behaviour -->
  <script>${COPY_JS}</script>
</body>
</html>`;
}
