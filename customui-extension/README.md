# CustomUI

Reshape any website through plain-language conversation. A Chrome extension that lets non-technical users describe what they want changed about a webpage — and an LLM rewrites the page for them in real time.

> **Status:** Proof of concept (v0.1). See [PRD](../PRD-PersonalizedUI-ChromeExtension.md) for full product spec.

---

## Quick start

### 1. Install the extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `customui-extension/` folder

### 2. Add your API key

1. Click the CustomUI icon in the toolbar
2. Click the gear icon to open Settings
3. Paste your API key (default: Anthropic Claude — get one at [console.anthropic.com](https://console.anthropic.com/))
4. Pick a model (default: `claude-sonnet-4-6`)
5. Click **Save**

### 3. Customize a page

1. Visit any website you'd like to improve
2. Click the CustomUI icon
3. Describe what you'd like to change — e.g. *"hide the sidebar and make the order cards bigger"*
4. Watch the page transform
5. Refine with follow-up messages — *"also enlarge the date column"*
6. Click **Save for this page** to persist; it'll auto-apply on every visit

---

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  Popup UI   │◄────►│  Background  │◄────►│  Content    │
│  (Chat)     │      │  Service     │      │  Script     │
└─────────────┘      │  Worker      │      │  (per tab)  │
                     └──────┬───────┘      └─────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Cloud LLM   │
                     │  (Claude)    │
                     └──────────────┘
```

| Component | Responsibility |
|---|---|
| `popup/` | Chat interface — sends user messages, renders AI responses, save/reset controls |
| `background/` | Service worker — orchestrates DOM capture → LLM API → injection, manages persistence and auto-apply |
| `content/` | Captures and prunes the page DOM, injects generated CSS/JS, flash-highlights modified elements |
| `options/` | Settings page — API key, model, saved modifications, blocklist |
| `utils/` | Shared helpers — DOM pruner, LLM client, storage, safety guardrails |

---

## File structure

```
customui-extension/
├── manifest.json              # MV3 manifest
├── popup/
│   ├── popup.html             # Chat interface markup
│   ├── popup.css              # Chat interface styles
│   └── popup.js               # Chat logic, message handling
├── background/
│   └── background.js          # Service worker (orchestration, LLM calls, auto-apply)
├── content/
│   └── content.js             # DOM capture, pruning, injection
├── options/
│   ├── options.html           # Settings page markup
│   ├── options.css            # Settings page styles
│   └── options.js             # Settings logic
├── utils/
│   ├── dom-pruner.js          # DOM summarization (also inlined in content.js)
│   ├── llm-client.js          # Anthropic / OpenAI API client
│   ├── storage.js             # chrome.storage.local helpers + URL glob matching
│   └── safety.js              # Guardrails: JS keyword blocklist, domain blocklist
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

> **Note:** Because MV3 content scripts cannot use ES module `import`, the DOM pruner and JS validator are duplicated inline in `content/content.js`. The `utils/` versions are used by the background worker, popup, and options page (which all support modules).

---

## How it works (single turn)

```
1.  User types message in popup
2.  Popup → Background:        { type: "user_message", text }
3.  Background → Content:      { type: "capture_dom" }
4.  Content → Background:      { html, url, title, viewport }
5.  Background builds prompt   (system + history + DOM + user message)
6.  Background → Cloud LLM:    POST /messages
7.  LLM → Background:          { css, js, explanation }
8.  Background → Content:      { type: "inject_mods", css, js }
9.  Content injects into page
10. Background → Popup:        { explanation }
11. Popup renders explanation
```

---

## Safety guardrails (PoC level)

- **JS keyword blocklist** — generated JS containing `fetch(`, `XMLHttpRequest`, `document.cookie`, `localStorage`, `eval(`, `Function(`, etc. is rejected before injection
- **Domain blocklist** — CustomUI never activates on banking, payment, or password manager domains
- **Sensitive page detection** — pages containing password fields or payment inputs trigger a warning banner
- **Scoped injection** — CSS injected via a single `<style>` element with a unique ID; JS wrapped in an IIFE with `"use strict"`

See `utils/safety.js` for the full list.

---

## Configuration

Settings are stored in `chrome.storage.local` and editable from the Options page:

| Setting | Default | Notes |
|---|---|---|
| **Provider** | `anthropic` | `anthropic`, `openai`, or `custom` |
| **API Key** | *(empty)* | BYOK — your key never leaves your browser except to the provider |
| **Model** | `claude-sonnet-4-6` | Any model name your provider supports |
| **Custom Endpoint** | *(empty)* | OpenAI-compatible endpoint, used when provider = `custom` |
| **Blocklist** | banking + payment domains | Domains where CustomUI will never activate |

---

## Storage schema

Saved modifications live under `chrome.storage.local["customui_mods"]`:

```json
{
  "store.acme.com/account/orders*": {
    "urlPattern": "store.acme.com/account/orders*",
    "displayName": "store.acme.com — account › orders",
    "css": "...",
    "js": "...",
    "originalPrompt": "Hide the sidebar and make order cards bigger",
    "conversationHistory": [...],
    "createdAt": "2026-04-28T14:30:00Z",
    "updatedAt": "2026-04-28T14:30:00Z",
    "version": 1,
    "enabled": true
  }
}
```

URL patterns use glob-style `*` wildcards. The most specific pattern wins when multiple match.

---

## Development

There's no build step. Edit a file → reload the extension at `chrome://extensions` → reload the target page.

### Reloading after changes

| Changed file | Action needed |
|---|---|
| `manifest.json` | Click reload on the extension card |
| `background/*` | Click reload on the extension card |
| `content/*` | Click reload on the extension card **and** reload the target page |
| `popup/*` | Reopen the popup |
| `options/*` | Reload the options tab |

### Debugging

- **Popup** — right-click the popup → *Inspect*
- **Background** — extension card → *Inspect views: service worker*
- **Content script** — DevTools on the host page → *Console* (filter for `[CustomUI]`)

---

## Known limitations (PoC)

- **No SPA support** — modifications don't auto-reapply after client-side route changes (no MutationObserver yet)
- **No URL pattern editing** — saved patterns are auto-generated, not user-editable from the popup
- **No conversation persistence** — chat history is lost when the popup closes (only saved mods persist)
- **No cross-browser support** — Chrome (and Chromium-based browsers) only
- **No self-healing** — saved mods can break when sites update their DOM; user has to re-generate

See PRD § 8 (risks) and § 9 (out of scope) for the full list.

---

## License

Internal proof of concept. Not yet licensed for distribution.
