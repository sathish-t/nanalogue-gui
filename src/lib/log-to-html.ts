// Converts LLM message arrays into self-contained HTML files for session review.

/**
 * Converts an array of LLM messages into a self-contained HTML file for
 * human review. Used by the conversation and LLM request dump commands.
 *
 * All rendering (markdown, syntax highlighting) is done at generation time
 * by local escaping-first renderers. The output HTML contains only a small
 * inline script for the copy button; no external JavaScript dependencies.
 */

import { renderChatCodeBlock, renderChatMarkdown } from "./chat-markdown.js";
import type { LlmMessage } from "./chat-orchestrator.js";
import { COPY_JS, HLJS_THEME_CSS, PAGE_CSS } from "./log-to-html-assets.js";

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
 * Validates untrusted execution-result JSON before rendering a structured card.
 * Unknown fields and arbitrary JSON values are allowed; display fields must be typed.
 *
 * @param value - Parsed JSON from a message that claims to be an execution result.
 * @returns True for an object with valid optional display fields and a safe round count.
 */
function isExecResultPayload(value: unknown): value is ExecResultPayload {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const fields = value as Record<string, unknown>;
    return (
        ["success", "value_truncated", "truncated", "is_timeout"].every(
            (key) =>
                fields[key] === undefined || typeof fields[key] === "boolean",
        ) &&
        ["prints", "error_type", "message", "hint"].every(
            (key) =>
                fields[key] === undefined || typeof fields[key] === "string",
        ) &&
        (fields.rounds_remaining === undefined ||
            (typeof fields.rounds_remaining === "number" &&
                Number.isSafeInteger(fields.rounds_remaining) &&
                fields.rounds_remaining >= 0))
    );
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
        const parsed: unknown = JSON.parse(jsonStr);
        if (isExecResultPayload(parsed)) {
            payload = parsed;
        }
    } catch {
        /* Invalid JSON or field types use the escaped raw-content fallback. */
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
 * @returns HTML string.
 */
function renderSystemMessage(content: string): string {
    const lineCount = content.split("\n").length;
    const bodyHtml = renderChatMarkdown(content);
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
 * @returns HTML string.
 */
function renderUserMessage(content: string): string {
    /* Render as markdown in case the user typed something with formatting,
       but keep it simple — most prompts are plain prose. Raw HTML is escaped. */
    const bodyHtml = renderChatMarkdown(content, { breaks: true });
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
 * Older models). Bare Python is highlighted directly; fenced responses go
 * through the local Markdown renderer.
 *
 * @param content - The assistant message text (Python or markdown).
 * @returns HTML string.
 */
function renderAssistantMessage(content: string): string {
    const hasFence = /^ {0,3}(?:`{3,}|~{3,})/m.test(content);
    const bodyHtml = hasFence
        ? renderChatMarkdown(content)
        : renderChatCodeBlock(content, "python");
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
 * @param model - The selected LLM model name shown in the transcript header.
 * @returns A complete, self-contained HTML document as a string.
 */
export function generateChatHtml(
    messages: LlmMessage[],
    snapshotId: string,
    model: string,
): string {
    /* Render each message to HTML. */
    const messagesHtml = messages
        .map((msg) => {
            if (msg.role === "system") {
                return renderSystemMessage(msg.content);
            }
            if (msg.role === "user") {
                if (msg.content.startsWith("Code execution result:")) {
                    return renderExecResult(msg.content);
                }
                return renderUserMessage(msg.content);
            }
            if (msg.role === "assistant") {
                return renderAssistantMessage(msg.content);
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
  <!-- nanalogue chat transcript -->
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
    <div class="meta">${escapeHtml(snapshotId)} · ${msgCount} message${msgCount === 1 ? "" : "s"} · ${escapeHtml(model)} · generated ${escapeHtml(date)}</div>
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
