// Tests the safe Markdown subset and code highlighting used in chat transcripts.

import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderChatCodeBlock, renderChatMarkdown } from "./chat-markdown";

describe("renderChatCodeBlock", () => {
    it("highlights Python tokens and escapes untrusted characters", () => {
        const html = renderChatCodeBlock(
            'for value in range(2):\n    print("<x>", True, 0x2A, .5) # note',
            "py",
        );

        expect(html).toContain('class="hljs language-python"');
        expect(html).toContain('class="hljs-keyword">for</span>');
        expect(html).toContain('class="hljs-built_in">range</span>');
        expect(html).toContain('class="hljs-literal">True</span>');
        expect(html).toContain('class="hljs-number">0x2A</span>');
        expect(html).toContain(
            'class="hljs-string">&quot;&lt;x&gt;&quot;</span>',
        );
        expect(html).toContain('class="hljs-comment"># note</span>');
    });

    it("supports Python triple and unclosed strings", () => {
        const html = renderChatCodeBlock(
            'text = """line\\nline"""\nother = \'unclosed',
            "ipython extra-info",
        );

        expect(html.match(/hljs-string/g)).toHaveLength(2);
        expect(html).toContain("unclosed");
    });

    it("highlights JSON strings, numbers, and literals", () => {
        const html = renderChatCodeBlock(
            '{"ok": true, "missing": null, "count": -1.5e+2, "no": false}',
            "JSON",
        );

        expect(html).toContain('class="hljs language-json"');
        expect(html).toContain('class="hljs-string">&quot;ok&quot;</span>');
        expect(html).toContain('class="hljs-literal">true</span>');
        expect(html).toContain('class="hljs-number">1.5e+2</span>');
    });

    it("renders unsupported languages as escaped plaintext", () => {
        const html = renderChatCodeBlock("<script>x</script>", "javascript");

        expect(html).toContain('class="hljs language-plaintext"');
        expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
        expect(html).not.toContain("<script>");
    });
});

describe("renderChatMarkdown block rendering", () => {
    it("renders headings, paragraphs, rules, and optional hard breaks", () => {
        const markdown = "intro\n### Heading ###\n\nfirst\nsecond\n\n---";

        expect(renderChatMarkdown(markdown)).toContain(
            "<p>intro</p>\n<h3>Heading</h3>\n<p>first\nsecond</p>\n<hr>",
        );
        expect(renderChatMarkdown("first\r\nsecond", { breaks: true })).toBe(
            "<p>first<br>\nsecond</p>",
        );
    });

    it("renders fenced, tilde-fenced, unclosed, and indented code", () => {
        const markdown = [
            "```python",
            "return None",
            "```",
            "",
            "~~~json",
            '{"x": 1}',
            "~~~~",
            "",
            "    plain <code>",
            "    second line",
            "",
            "```text",
            "unclosed",
        ].join("\n");
        const html = renderChatMarkdown(markdown);

        expect(html).toContain("language-python");
        expect(html).toContain("language-json");
        expect(html).toContain("plain &lt;code&gt;\nsecond line");
        expect(html).toContain('language-plaintext">unclosed');
    });

    it("renders unordered and ordered lists", () => {
        const html = renderChatMarkdown(
            "- alpha\n+ beta\n\n1. first\n2) second",
        );

        expect(html).toContain("<ul><li>alpha</li><li>beta</li></ul>");
        expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    });

    it.each([
        "```",
        "~~~",
    ])("keeps deeply indented %s fences inside code", (fence) => {
        const code = `first()\n    ${fence}\nsecond()\n\t${fence}\nthird()`;
        expect(
            renderChatMarkdown(`${fence}text\n${code}\n   ${fence} \t\nafter`),
        ).toBe(
            `<pre><code class="hljs language-plaintext">${code}</code></pre>\n<p>after</p>`,
        );
    });

    it("renders block quotes recursively", () => {
        const html = renderChatMarkdown("> ## Note\n> quoted");

        expect(html).toBe(
            "<blockquote><h2>Note</h2>\n<p>quoted</p></blockquote>",
        );
    });

    it("renders tables and pads short body rows", () => {
        const html = renderChatMarkdown(
            "| Name | Value |\n| :--- | ---: |\n| one | **two** |\n| only-one |",
        );

        expect(html).toContain("<th>Name</th><th>Value</th>");
        expect(html).toContain("<td>one</td><td><strong>two</strong></td>");
        expect(html).toContain("<td>only-one</td><td></td>");
    });

    it("keeps escaped pipes in their table cells, including at row edges", () => {
        const html = renderChatMarkdown(
            String.raw`| A\|B | Value |
| --- | --- |
| left\|right | keep |
\|leading | trailing\|
| backslash\\| separate |
| three\\\|pipes | last |`,
        );
        expect(html).toContain("<th>A|B</th><th>Value</th>");
        expect(html).toContain("<td>left|right</td><td>keep</td>");
        expect(html).toContain("<td>|leading</td><td>trailing|</td>");
        expect(html).toContain(
            String.raw`<td>backslash\</td><td>separate</td>`,
        );
        expect(html).toContain(String.raw`<td>three\|pipes</td><td>last</td>`);
    });

    it("rejects excess table cells instead of dropping their contents", () => {
        expect(() =>
            renderChatMarkdown(
                "| A | B |\n| --- | --- |\n| one | two | lost |",
            ),
        ).toThrow(
            "Chat Markdown parsing error: too many table cells at line 3.",
        );
    });
});

describe("renderChatMarkdown inline rendering", () => {
    it("supports emphasis, deletion, code spans, and escapes", () => {
        const html = renderChatMarkdown(
            "**bold** __also__ *italic* _again_ ~~gone~~ `a < b` ``tick ` inside`` \\*literal*",
        );

        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("__also__");
        expect(html).toContain("<em>italic</em>");
        expect(html).toContain("_again_");
        expect(html).toContain("<del>gone</del>");
        expect(html).toContain("<code>a &lt; b</code>");
        expect(html).toContain("<code>tick ` inside</code>");
        expect(html).toContain("*literal*");
    });

    it.each([
        [String.raw`*a\*b*`, "<p><em>a*b</em></p>"],
        [String.raw`**a\*\*b**`, "<p><strong>a**b</strong></p>"],
        [String.raw`~~a\~\~b~~`, "<p><del>a~~b</del></p>"],
        [String.raw`*a\\* tail`, String.raw`<p><em>a\</em> tail</p>`],
        ["`a``b`", "<p><code>a``b</code></p>"],
        ["``a```b`c``", "<p><code>a```b`c</code></p>"],
        ["x ``unclosed`", "<p>x ``unclosed`</p>"],
        ["\\``a`", "<p>`<code>a</code></p>"],
        ["`a\\`b", "<p><code>a\\</code>b</p>"],
        ["**`a**b`**", "<p><strong><code>a**b</code></strong></p>"],
        ["*`a*b`*", "<p><em><code>a*b</code></em></p>"],
        ["~~`a~~b`~~", "<p><del><code>a~~b</code></del></p>"],
        [
            "**before `a**b` after**",
            "<p><strong>before <code>a**b</code> after</strong></p>",
        ],
        [
            "**~~`<x> ** * ~~ \\q`~~**",
            "<p><strong><del><code>&lt;x&gt; ** * ~~ \\q</code></del></strong></p>",
        ],
        ["*a `unclosed*", "<p><em>a `unclosed</em></p>"],
        ["[`x](lost)`](url)", "<p><code>x](lost)</code></p>"],
        ["![`[[[x]]]`](url)", "<p><code>[[[x]]]</code></p>"],
        ["**[x](a**b)**", "<p><strong>x</strong></p>"],
        ["*![x](a*b)*", "<p><em>x</em></p>"],
        [
            "**[x](u`)** `a` **b**",
            "<p><strong>x</strong> <code>a</code> <strong>b</strong></p>",
        ],
        [
            "**[`x](lost)`](url)**",
            "<p><strong><code>x](lost)</code></strong></p>",
        ],
        ["*[a*b] c*", "<p><em>[a*b] c</em></p>"],
        ["*a **b** c*", "<p><em>a <strong>b</strong> c</em></p>"],
        ["**a *b* c**", "<p><strong>a <em>b</em> c</strong></p>"],
        ["*a **b***", "<p><em>a <strong>b</strong></em></p>"],
        ["**a *b***", "<p><strong>a <em>b</em></strong></p>"],
        ["***x***", "<p><strong><em>x</em></strong></p>"],
        [
            "*a **`x**y`** c*",
            "<p><em>a <strong><code>x**y</code></strong> c</em></p>",
        ],
    ])("preserves escaped markers and code contents in %j", (markdown, expected) => {
        expect(renderChatMarkdown(markdown)).toBe(expected);
    });

    it("preserves paths and identifiers while unescaping supported punctuation", () => {
        expect(
            renderChatMarkdown(String.raw`C:\reads\sample.bam sample_read_id`),
        ).toBe(String.raw`<p>C:\reads\sample.bam sample_read_id</p>`);
        expect(
            renderChatMarkdown(
                "### read_file(file_path: str, **kwargs) -> dict",
            ),
        ).toBe("<h3>read_file(file_path: str, **kwargs) -&gt; dict</h3>");
        expect(
            renderChatMarkdown(
                "\\*literal\\* \\~gone\\~ \\[label\\] \\| \\q end\\",
            ),
        ).toBe(String.raw`<p>*literal* ~gone~ [label] | \q end\</p>`);
    });

    it("strips link and image destinations while retaining labels", () => {
        const html = renderChatMarkdown(
            "[**docs**](javascript:alert(1)) ![diagram](https://example.com/x.png)",
        );

        expect(html).toContain("<strong>docs</strong>");
        expect(html).toContain("diagram");
        expect(html).not.toContain("<strong>docs</strong>)");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("example.com");
        expect(html).not.toContain("<a");
        expect(html).not.toContain("<img");
    });

    it("leaves unmatched Markdown delimiters visible and escapes raw HTML", () => {
        const html = renderChatMarkdown(
            "<script>alert(1)</script> [link missing `code **bold",
        );

        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).toContain("[link missing");
        expect(html).toContain("`code **bold");
    });
});

describe("renderChatMarkdown parsing limits", () => {
    it("preserves a long unmatched backtick run without rescanning its suffixes", () => {
        const markdown = `x ${"`".repeat(60000)}`;
        expect(
            runInNewContext(
                "renderChatMarkdown(markdown)",
                { renderChatMarkdown, markdown },
                { timeout: 1000 },
            ),
        ).toBe(`<p>${markdown}</p>`);
    });

    it.each([
        ["# x\u2028y", "<h1>x</h1>\n<p>y</p>"],
        ["# x\u2029y", "<h1>x</h1>\n<p>y</p>"],
        ["- x\u2028y", "<ul><li>x</li></ul>\n<p>y</p>"],
        ["- x\u2029y", "<ul><li>x</li></ul>\n<p>y</p>"],
    ])("normalizes Unicode separators without looping for %j", (markdown, expected) => {
        // VM interruption protects the test process if parsing stops advancing.
        expect(
            runInNewContext(
                "renderChatMarkdown(markdown)",
                { renderChatMarkdown, markdown },
                { timeout: 1000 },
            ),
        ).toBe(expected);
    });

    it("normalizes only the two Unicode separators alongside CRLF and CR, even inside code", () => {
        expect(
            renderChatMarkdown("a\u2028b\u2029c\r\nd\re\nf", { breaks: true }),
        ).toBe("<p>a<br>\nb<br>\nc<br>\nd<br>\ne<br>\nf</p>");
        expect(renderChatMarkdown("a\u0085b\u00a0c\u2003d")).toBe(
            "<p>a\u0085b\u00a0c\u2003d</p>",
        );
        expect(renderChatMarkdown("```text\nx\u2028y\u2029z\n```")).toBe(
            '<pre><code class="hljs language-plaintext">x\ny\nz</code></pre>',
        );
    });

    it("allows two levels of inline formatting and blockquotes, but rejects three", () => {
        expect(renderChatMarkdown("**~~ok~~**")).toBe(
            "<p><strong><del>ok</del></strong></p>",
        );
        expect(() => renderChatMarkdown("**~~*no*~~**")).toThrow(
            "inline nesting exceeds 2 levels",
        );
        expect(() => renderChatMarkdown("*~~**no**~~*")).toThrow(
            "inline nesting exceeds 2 levels",
        );
        expect(renderChatMarkdown("> > ok")).toBe(
            "<blockquote><blockquote><p>ok</p></blockquote></blockquote>",
        );
        expect(() => renderChatMarkdown("> > > no")).toThrow(
            "blockquote nesting exceeds 2 levels",
        );
    });

    it("limits link labels and destination parentheses to two levels including the outer pair", () => {
        expect(renderChatMarkdown("[[ok](inner)](outer)")).toBe("<p>ok</p>");
        expect(() => renderChatMarkdown("**[**no**](url)**")).toThrow(
            "inline nesting exceeds 2 levels",
        );
        expect(() =>
            renderChatMarkdown("[[[no](inner)](middle)](outer)"),
        ).toThrow("link nesting exceeds 2 levels");
        expect(renderChatMarkdown("[ok](a(b))")).toBe("<p>ok</p>");
        expect(() => renderChatMarkdown("[no](a(b(c)))")).toThrow(
            "link nesting exceeds 2 levels",
        );
        expect(renderChatMarkdown(String.raw`[ok](a\(b\))`)).toBe("<p>ok</p>");
        expect(renderChatMarkdown(String.raw`[a\[b](url)`)).toBe("<p>a[b</p>");
    });

    it("consumes bracketed non-links without swallowing a later link", () => {
        expect(renderChatMarkdown("[0, 1] then [docs](url)")).toBe(
            "<p>[0, 1] then docs</p>",
        );
        expect(renderChatMarkdown("[[literal]] [unclosed <tag>")).toBe(
            "<p>[[literal]] [unclosed &lt;tag&gt;</p>",
        );
    });

    it.each([
        [
            `${"[".repeat(50000)}](${"(".repeat(50000)}`,
            "link nesting exceeds 2 levels",
        ],
        [`${"[x] ".repeat(20000)}[link](missing`, "unclosed link destination"],
        [`[link](${"x".repeat(100000)}`, "unclosed link destination"],
        [`${"> ".repeat(10000)}x`, "blockquote nesting exceeds 2 levels"],
    ])("rejects adversarial input case %# without rescanning or deep recursion", (markdown, message) => {
        expect(() =>
            runInNewContext(
                "renderChatMarkdown(markdown)",
                { renderChatMarkdown, markdown },
                { timeout: 1000 },
            ),
        ).toThrow(`Chat Markdown parsing error: ${message}.`);
    });

    it("does not apply Markdown nesting limits inside code", () => {
        expect(renderChatMarkdown("`[[[x]]]`")).toBe(
            "<p><code>[[[x]]]</code></p>",
        );
        expect(renderChatMarkdown("```text\n>>> [[[x]]]\n```")).toContain(
            "&gt;&gt;&gt; [[[x]]]",
        );
    });
});
