// Shared inline assets for self-contained chat transcript HTML output.

// ---------------------------------------------------------------------------
// Highlight.js theme CSS (atom-one-dark), inlined so the HTML is self-contained
// ---------------------------------------------------------------------------

export const /** Atom-one-dark theme CSS from highlight.js, inlined for self-contained output. */ HLJS_THEME_CSS = `pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}.hljs{color:#abb2bf;background:#282c34}.hljs-comment,.hljs-quote{color:#5c6370;font-style:italic}.hljs-doctag,.hljs-formula,.hljs-keyword{color:#c678dd}.hljs-deletion,.hljs-name,.hljs-section,.hljs-selector-tag,.hljs-subst{color:#e06c75}.hljs-literal{color:#56b6c2}.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#98c379}.hljs-attr,.hljs-number,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-pseudo,.hljs-template-variable,.hljs-type,.hljs-variable{color:#d19a66}.hljs-bullet,.hljs-link,.hljs-meta,.hljs-selector-id,.hljs-symbol,.hljs-title{color:#61aeee}.hljs-built_in,.hljs-class .hljs-title,.hljs-title.class_{color:#e6c07b}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}.hljs-link{text-decoration:underline}`;

// ---------------------------------------------------------------------------
// Copy-button JavaScript, inlined in the output HTML
// ---------------------------------------------------------------------------

export const /** Minimal inline JavaScript that wires up the copy button on each assistant message. Uses the Clipboard API; on failure silently resets the button label. Reads innerText from the pre/code block so the copied text is plain code, not the highlighted HTML markup. */ COPY_JS = `
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

export const /** Page-level CSS for the chat transcript HTML output. */ PAGE_CSS = `
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
