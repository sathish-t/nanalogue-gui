/**
 * Tests for generateChatHtml — verifies that the correct HTML structure and
 * content is produced for each message role variant.
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "./chat-orchestrator.js";
import { generateChatHtml } from "./log-to-html.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the HTML for a single-message conversation of the given role.
 *
 * @param role - The message role (e.g. "user", "assistant", "system").
 * @param content - The message content string.
 * @returns The full HTML document string for the single-message session.
 */
function htmlFor(role: string, content: string): string {
    return generateChatHtml([{ role, content }], "test-snapshot-id");
}

// ---------------------------------------------------------------------------
// Page skeleton
// ---------------------------------------------------------------------------

describe("generateChatHtml page skeleton", () => {
    it("produces a valid HTML5 document", () => {
        const html = htmlFor("user", "hello");
        expect(html).toMatch(/^<!DOCTYPE html>/);
        expect(html).toContain('<html lang="en">');
        expect(html).toContain("</html>");
    });

    it("includes the snapshot id in the title", () => {
        const html = generateChatHtml([], "my-uuid-123");
        expect(html).toContain("my-uuid-123");
    });

    it("includes the message count in the header meta", () => {
        const msgs: LlmMessage[] = [
            { role: "system", content: "sys" },
            { role: "user", content: "hi" },
        ];
        const html = generateChatHtml(msgs, "x");
        expect(html).toContain("2 messages");
    });

    it("uses singular 'message' when there is exactly one message", () => {
        const html = htmlFor("user", "hi");
        expect(html).toContain("1 message");
        expect(html).not.toContain("1 messages");
    });

    it("inlines the highlight.js atom-one-dark CSS", () => {
        const html = htmlFor("assistant", "x = 1");
        expect(html).toContain(".hljs{");
    });
});

// ---------------------------------------------------------------------------
// System message
// ---------------------------------------------------------------------------

describe("renderSystemMessage", () => {
    it("wraps the system prompt in a <details> element", () => {
        const html = htmlFor("system", "# Hello\n\nworld");
        expect(html).toContain("<details");
        expect(html).toContain("</details>");
    });

    it("includes a summary with the line count", () => {
        const content = "line1\nline2\nline3";
        const html = htmlFor("system", content);
        expect(html).toContain("3 lines");
    });

    it("renders markdown headers inside the system message", () => {
        const html = htmlFor("system", "### My Header");
        expect(html).toContain("<h3>My Header</h3>");
    });

    it("renders fenced code blocks inside the system message", () => {
        const html = htmlFor("system", "```python\nx = 1\n```");
        expect(html).toContain("hljs");
        expect(html).toContain("x");
    });
});

// ---------------------------------------------------------------------------
// User (human) message
// ---------------------------------------------------------------------------

describe("renderUserMessage (human prompt)", () => {
    it("does not start with Code execution result", () => {
        const html = htmlFor("user", "please analyse the data");
        expect(html).toContain('class="message message-user"');
        expect(html).not.toContain('class="message message-exec');
    });

    it("includes the message content", () => {
        const html = htmlFor("user", "please analyse the data");
        expect(html).toContain("please analyse the data");
    });

    it("has a User header label", () => {
        const html = htmlFor("user", "hi");
        expect(html).toContain(">User<");
    });
});

// ---------------------------------------------------------------------------
// Execution result message
// ---------------------------------------------------------------------------

describe("renderExecResult (code execution feedback)", () => {
    it("uses the exec message class for execution results", () => {
        const content =
            'Code execution result: {"success":true,"rounds_remaining":3}';
        const html = htmlFor("user", content);
        expect(html).toContain('class="message message-exec');
        expect(html).not.toContain('class="message message-user"');
    });

    it("shows success icon for successful results", () => {
        const content =
            'Code execution result: {"success":true,"rounds_remaining":2}';
        const html = htmlFor("user", content);
        expect(html).toContain("✓");
    });

    it("shows failure icon for failed results", () => {
        const content =
            'Code execution result: {"success":false,"error_type":"SyntaxError","message":"bad syntax","rounds_remaining":1}';
        const html = htmlFor("user", content);
        expect(html).toContain("✗");
    });

    it("renders the error class for failed results", () => {
        const content =
            'Code execution result: {"success":false,"error_type":"RuntimeError","message":"oops","rounds_remaining":0}';
        const html = htmlFor("user", content);
        expect(html).toContain("message-exec-error");
    });

    it("renders the ok class for successful results", () => {
        const content =
            'Code execution result: {"success":true,"rounds_remaining":4}';
        const html = htmlFor("user", content);
        expect(html).toContain("message-exec-ok");
    });

    it("shows rounds remaining badge", () => {
        const content =
            'Code execution result: {"success":true,"rounds_remaining":5}';
        const html = htmlFor("user", content);
        expect(html).toContain("5 rounds left");
    });

    it("shows singular round when rounds_remaining is 1", () => {
        const content =
            'Code execution result: {"success":true,"rounds_remaining":1}';
        const html = htmlFor("user", content);
        expect(html).toContain("1 round left");
        expect(html).not.toContain("1 rounds left");
    });

    it("renders prints output when present", () => {
        const content =
            'Code execution result: {"success":true,"prints":"hello world\\n","rounds_remaining":2}';
        const html = htmlFor("user", content);
        expect(html).toContain("hello world");
        expect(html).toContain("exec-prints");
    });

    it("renders value when present", () => {
        const content =
            'Code execution result: {"success":true,"value":42,"rounds_remaining":2}';
        const html = htmlFor("user", content);
        expect(html).toContain("42");
        expect(html).toContain("exec-value");
    });

    it("renders error_type and message on failure", () => {
        const content =
            'Code execution result: {"success":false,"error_type":"NameError","message":"name x not defined","rounds_remaining":1}';
        const html = htmlFor("user", content);
        expect(html).toContain("NameError");
        expect(html).toContain("name x not defined");
    });

    it("renders hint when present on failure", () => {
        const content =
            'Code execution result: {"success":false,"error_type":"SyntaxError","message":"bad","hint":"Use Python only","rounds_remaining":0}';
        const html = htmlFor("user", content);
        expect(html).toContain("Use Python only");
    });

    it("falls back gracefully when JSON is malformed", () => {
        const content = "Code execution result: {not valid json";
        const html = htmlFor("user", content);
        expect(html).toContain("message-exec-error");
        expect(html).toContain("Code execution result");
    });

    it("handles value_truncated flag", () => {
        const content =
            'Code execution result: {"success":true,"value":"big","value_truncated":true,"rounds_remaining":1}';
        const html = htmlFor("user", content);
        expect(html).toContain("truncated");
    });
});

// ---------------------------------------------------------------------------
// Assistant message
// ---------------------------------------------------------------------------

describe("copy button", () => {
    it("includes a copy button in the assistant message header", () => {
        const html = htmlFor("assistant", "x = 1");
        expect(html).toContain('class="copy-btn"');
    });

    it("copy button has an accessible aria-label", () => {
        const html = htmlFor("assistant", "x = 1");
        expect(html).toContain('aria-label="Copy code to clipboard"');
    });

    it("includes a copy button in user messages", () => {
        const html = htmlFor("user", "please analyse the data");
        expect(html).toContain('class="copy-btn"');
    });

    it("does not include a copy button in system messages", () => {
        const html = htmlFor("system", "# System prompt");
        expect(html).not.toContain('class="copy-btn"');
    });

    it("includes the copy button script in the page", () => {
        const html = htmlFor("assistant", "x = 1");
        expect(html).toContain("navigator.clipboard");
    });
});

describe("renderAssistantMessage", () => {
    it("uses the assistant message class", () => {
        const html = htmlFor("assistant", "x = 1\nprint(x)");
        expect(html).toContain("message-assistant");
    });

    it("has an Assistant header label", () => {
        const html = htmlFor("assistant", "x = 1");
        expect(html).toContain(">Assistant<");
    });

    it("syntax-highlights bare Python code", () => {
        const html = htmlFor("assistant", "for i in range(10):\n    print(i)");
        /* highlight.js wraps keywords in hljs spans */
        expect(html).toContain("hljs-keyword");
    });

    it("syntax-highlights fenced Python code blocks", () => {
        const html = htmlFor(
            "assistant",
            "```python\nfor i in range(5):\n    print(i)\n```",
        );
        expect(html).toContain("hljs-keyword");
    });

    it("does not double-wrap already-fenced content", () => {
        const html = htmlFor("assistant", "```python\nx = 1\n```");
        /* Should not have ```python literally in the output */
        expect(html).not.toContain("```python");
    });

    it("renders bare Python without literal backticks in output", () => {
        const html = htmlFor("assistant", "x = 1");
        expect(html).not.toContain("```");
    });
});

// ---------------------------------------------------------------------------
// Unknown role fallback
// ---------------------------------------------------------------------------

describe("unknown role fallback", () => {
    it("renders unknown roles without crashing", () => {
        const html = htmlFor("tool", "some tool output");
        expect(html).toContain("tool");
        expect(html).toContain("some tool output");
    });
});

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

describe("HTML escaping", () => {
    it("escapes < and > in user message content", () => {
        /* marked itself handles escaping in rendered text; the test confirms
           the raw angle brackets don't appear unescaped at the top level. */
        const html = htmlFor("user", "x < y and y > 0");
        expect(html).not.toMatch(/<div[^>]*>x < y/);
    });

    it("escapes the snapshot id in the title", () => {
        const html = generateChatHtml([], "<script>alert(1)</script>");
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("does not pass raw HTML script tags through marked in any role", () => {
        const payload = "<script>alert('xss')</script>";
        for (const role of ["system", "user", "assistant"] as const) {
            const html = htmlFor(role, payload);
            /* The literal opening script tag must not appear unescaped. */
            expect(html).not.toContain("<script>alert(");
        }
    });

    it("renders markdown links as plain text (no anchor element)", () => {
        const html = htmlFor("user", "[docs](https://example.com)");
        expect(html).not.toContain("<a ");
        expect(html).toContain("docs");
    });

    it("strips javascript: URLs from markdown links entirely", () => {
        const html = htmlFor("user", "[click](javascript:alert(1))");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("<a ");
    });

    it("strips data: URLs from markdown links entirely", () => {
        const html = htmlFor("user", "[x](data:text/html,foo)");
        expect(html).not.toContain("data:text");
        expect(html).not.toContain("<a ");
    });

    it("strips markdown images to alt text — no img element", () => {
        const html = htmlFor("user", "![diagram](https://example.com/img.png)");
        expect(html).not.toContain("<img");
        expect(html).not.toContain("https://example.com");
        expect(html).toContain("diagram");
    });

    it("strips data: URI images — no img element", () => {
        const html = htmlFor("system", "![x](data:image/png;base64,abc)");
        expect(html).not.toContain("<img");
        expect(html).not.toContain("data:image");
    });
});
