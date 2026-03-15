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

// ---------------------------------------------------------------------------
// Highlight.js theme CSS (atom-one-dark), inlined so the HTML is self-contained
// ---------------------------------------------------------------------------

/** Atom-one-dark theme CSS from highlight.js, inlined for self-contained output. */
const HLJS_THEME_CSS = `pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}.hljs{color:#abb2bf;background:#282c34}.hljs-comment,.hljs-quote{color:#5c6370;font-style:italic}.hljs-doctag,.hljs-formula,.hljs-keyword{color:#c678dd}.hljs-deletion,.hljs-name,.hljs-section,.hljs-selector-tag,.hljs-subst{color:#e06c75}.hljs-literal{color:#56b6c2}.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#98c379}.hljs-attr,.hljs-number,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-pseudo,.hljs-template-variable,.hljs-type,.hljs-variable{color:#d19a66}.hljs-bullet,.hljs-link,.hljs-meta,.hljs-selector-id,.hljs-symbol,.hljs-title{color:#61aeee}.hljs-built_in,.hljs-class .hljs-title,.hljs-title.class_{color:#e6c07b}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}.hljs-link{text-decoration:underline}`;

// ---------------------------------------------------------------------------
// Copy-button JavaScript, inlined in the output HTML
// ---------------------------------------------------------------------------

/**
 * Minimal inline JavaScript that wires up the copy button on each assistant
 * message. Uses the Clipboard API; on failure silently resets the button label.
 * Reads innerText from the pre/code block so the copied text is plain code,
 * not the highlighted HTML markup.
 */
const COPY_JS = `
function copyText(text, btn) {
    function onSuccess() {
        btn.textContent = '\\u2713 Copied';
        btn.classList.add('copied');
        setTimeout(function() {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
        }, 2000);
    }
    function onFail() {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
    }
    /* Use the Clipboard API where available (modern browsers, https, and most
       file:// contexts). Fall back to the deprecated execCommand for older
       browsers and platforms where Clipboard API is unavailable on file://. */
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onSuccess).catch(function() {
            execCopy(text, onSuccess, onFail);
        });
    } else {
        execCopy(text, onSuccess, onFail);
    }
}
function execCopy(text, onSuccess, onFail) {
    try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? onSuccess() : onFail();
    } catch (e) {
        onFail();
    }
}
document.querySelectorAll('.copy-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var msgEl = btn.closest('.message-assistant, .message-user');
        if (!msgEl) return;
        var codeEl = msgEl.querySelector('pre code');
        var bodyEl = msgEl.querySelector('.message-body');
        var text = codeEl ? codeEl.innerText : (bodyEl ? bodyEl.innerText : '');
        copyText(text, btn);
    });
});
`;

// ---------------------------------------------------------------------------
// Page-level CSS
// ---------------------------------------------------------------------------

/** Page-level CSS for the chat transcript HTML output. */
const PAGE_CSS = `
*, *::before, *::after { box-sizing: border-box; }

body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    color: #1a1a2e;
    background: #f4f6fb;
    margin: 0;
    padding: 24px 16px 48px;
}

header {
    max-width: 860px;
    margin: 0 auto 28px;
    padding-bottom: 14px;
    border-bottom: 2px solid #d0d7e8;
}

header h1 {
    margin: 0 0 4px;
    font-size: 1.25rem;
    font-weight: 700;
    color: #16213e;
}

header .meta {
    font-size: 0.82rem;
    color: #6b7a99;
}

main {
    max-width: 860px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

/* --- shared message shell --- */
.message {
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}

.message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.message-body {
    padding: 14px 18px;
}

.message-body p:first-child { margin-top: 0; }
.message-body p:last-child  { margin-bottom: 0; }

/* --- system message --- */
.message-system {
    background: #f0f0f5;
    border: 1px solid #d4d4e8;
}

.message-system summary {
    list-style: none;
    cursor: pointer;
    padding: 10px 14px;
    font-size: 0.82rem;
    font-weight: 600;
    color: #555577;
    display: flex;
    align-items: center;
    gap: 6px;
    user-select: none;
}

.message-system summary::-webkit-details-marker { display: none; }

.message-system summary::before {
    content: "▶";
    font-size: 0.65rem;
    transition: transform 0.15s;
}

.message-system[open] summary::before { transform: rotate(90deg); }

.message-system .message-body {
    border-top: 1px solid #d4d4e8;
    font-size: 0.88rem;
    background: #f8f8fc;
}

/* --- user (human) message --- */
.message-user {
    background: #e8f0fe;
    border: 1px solid #b8cdf8;
}

.message-user .message-header {
    background: #c5d8fc;
    color: #1a3a7a;
}

/* --- execution result message --- */
.message-exec {
    border: 1px solid #d4c090;
}

.message-exec .message-header {
    color: #5a4000;
}

.message-exec-ok {
    background: #fffbef;
    border-color: #e8d080;
}

.message-exec-ok .message-header {
    background: #f5e8a0;
}

.message-exec-error {
    background: #fff5f5;
    border-color: #f0b0b0;
}

.message-exec-error .message-header {
    background: #f8c8c8;
    color: #7a1a1a;
}

.exec-section-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin: 10px 0 4px;
}

.exec-section-label:first-child { margin-top: 0; }

.exec-value, .exec-prints, .exec-error-detail {
    background: #282c34;
    color: #abb2bf;
    border-radius: 6px;
    padding: 10px 14px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.84rem;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
}

.rounds-badge {
    margin-left: auto;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(0,0,0,0.12);
    letter-spacing: 0;
    text-transform: none;
}

/* --- assistant message --- */
.message-assistant {
    background: #1e1e2e;
    border: 1px solid #3a3a5c;
    color: #cdd6f4;
}

.message-assistant .message-header {
    background: #2a2a4a;
    color: #a0a8d0;
}

.copy-btn {
    margin-left: auto;
    padding: 3px 10px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    text-transform: none;
    /* default: dark style for assistant bubble */
    background: rgba(255,255,255,0.08);
    color: #a0a8d0;
    border: 1px solid rgba(255,255,255,0.15);
}

.copy-btn:hover {
    background: rgba(255,255,255,0.16);
    color: #cdd6f4;
}

.copy-btn.copied {
    background: rgba(100,210,130,0.18);
    color: #82e0a0;
    border-color: rgba(100,210,130,0.3);
}

/* Light style for user bubble */
.message-user .copy-btn {
    background: rgba(0,0,0,0.06);
    color: #1a3a7a;
    border: 1px solid rgba(25,118,210,0.25);
}

.message-user .copy-btn:hover {
    background: rgba(0,0,0,0.12);
}

.message-user .copy-btn.copied {
    background: rgba(46,125,50,0.12);
    color: #2e7d32;
    border-color: rgba(46,125,50,0.3);
}

.message-assistant .message-body {
    color: #cdd6f4;
}

/* --- markdown output inside messages --- */
.message-body h1, .message-body h2, .message-body h3,
.message-body h4, .message-body h5, .message-body h6 {
    margin: 1em 0 0.4em;
    color: inherit;
}

.message-body code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.88em;
    background: rgba(0,0,0,0.12);
    padding: 1px 5px;
    border-radius: 4px;
}

.message-assistant .message-body code {
    background: rgba(255,255,255,0.08);
}

.message-body pre {
    margin: 10px 0;
    border-radius: 6px;
    overflow-x: auto;
}

.message-body pre code {
    background: none;
    padding: 0;
    font-size: 0.84rem;
}

.message-body table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.88rem;
    margin: 10px 0;
}

.message-body th, .message-body td {
    border: 1px solid rgba(0,0,0,0.15);
    padding: 6px 10px;
    text-align: left;
}

.message-assistant .message-body th,
.message-assistant .message-body td {
    border-color: rgba(255,255,255,0.12);
}

.message-body th { font-weight: 700; background: rgba(0,0,0,0.06); }
.message-assistant .message-body th { background: rgba(255,255,255,0.06); }

.message-body ul, .message-body ol {
    padding-left: 1.4em;
    margin: 6px 0;
}

.message-body blockquote {
    border-left: 3px solid rgba(0,0,0,0.2);
    margin: 8px 0;
    padding: 4px 12px;
    color: #666;
}

/* --- whole-message-is-code shortcut (assistant pure-Python path) --- */
.message-assistant .message-body > pre:only-child {
    margin: 0;
    border-radius: 0;
}

@media (max-width: 600px) {
    body { padding: 12px 8px 32px; }
    .message-body { padding: 10px 12px; }
    header h1 { font-size: 1.05rem; }
}
`;

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
