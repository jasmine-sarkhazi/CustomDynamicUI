# Personalized UI Tool — Product Requirements Document

**Product Name:** CustomUI (working title)
**Version:** 0.1 — Proof of Concept
**Author:** Jasmine Sarkhazi
**Date:** April 28, 2026
**Timeline:** 1–2 weeks (PoC)

---

## 1. Problem Statement

Modern web applications are built with a one-size-fits-all interface. Users regularly encounter pages that are clunky, overwhelming, or poorly organized for their specific task. They can't find what they need, are distracted by irrelevant elements, or struggle with unintuitive layouts. Today, the only options are to suffer through it, hire a developer, or learn to code — none of which are realistic for most people.

**CustomUI** lets any user reshape a website's interface through plain-language conversation. Describe what's frustrating, and the tool rewrites the page for you — in real time, on your browser, no code required.

---

## 2. Target Users

**Primary:** Non-technical users — people who can describe a problem in words but have no knowledge of HTML, CSS, or JavaScript. Think of someone who says *"I just want to see my recent orders without all this clutter"* rather than *"hide the sidebar and filter the table."*

**Personas:**

- **Sara, 58, small business owner** — Uses her supplier's wholesale portal daily but finds the multi-step reorder flow confusing. She just wants a simple "reorder last purchase" button.
- **Amir, 34, project manager** — His company's internal dashboard shows 30 metrics on one page. He only cares about 4 of them and wants to collapse everything else.
- **Priya, 22, college student** — Her university's course registration site has a notoriously bad UX. She wants to compare sections side-by-side instead of clicking back and forth.

---

## 3. Product Vision

A Chrome extension that acts as a personal UI designer. It understands the structure of any webpage and lets users "vibe code" a better version of it through natural-language conversation — then saves those customizations so the page looks right every time they visit.

### Core Loop

```
Frustration → Open Extension → Describe the Problem → AI Transforms the Page → Iterate → Save
```

---

## 4. Key Decisions (from discovery)

| Decision | Choice | Rationale |
|---|---|---|
| Target user | Non-technical | Widest impact; technical users already have Tampermonkey, Stylus, etc. |
| AI backend | Cloud LLM via API | Highest quality DOM understanding and code generation |
| API access model | BYOK (bring your own key) | Zero infrastructure cost for PoC; avoids rate-limit/billing complexity |
| Modification scope | Visual + Functional | CSS restyling alone is too limited; users need new elements and logic too |
| Prompt interface | Extension popup | Simplest to build; avoids content-script UI conflicts with host pages |
| Conversation model | Multi-turn chat | Users refine iteratively; they often don't know what they want upfront |
| Persistence | chrome.storage.local | Simple, offline-capable, keyed by URL pattern |

---

## 5. Feature Specification

### 5.1 Extension Popup — Chat Interface

**What it is:** When the user clicks the extension icon in the Chrome toolbar, a popup opens with a conversational chat interface.

**Behavior:**

- The popup shows a friendly welcome message and suggested starter prompts: *"Simplify this page," "Help me find...," "Make this form easier," "Hide distractions"*
- A text input at the bottom for freeform messages
- The conversation history is displayed as a chat thread (user messages and AI responses)
- An "Apply" indicator shows when modifications are being injected into the page
- A "Save" button persists the current modifications for this URL pattern
- A "Reset" button removes all current modifications and restores the original page

**Technical notes:**

- The popup communicates with a background service worker, which orchestrates DOM capture, LLM calls, and content-script injection
- Conversation state lives in memory (service worker) while the popup is open; it is cleared when the popup closes unless saved

### 5.2 DOM Context Engine

**What it is:** A content script that captures a meaningful, token-efficient representation of the current page's structure.

**Behavior:**

- On trigger (when user sends a message), the content script captures the page DOM
- The raw DOM is pruned and summarized:
  - Remove `<script>`, `<style>`, `<svg>`, hidden elements, and `<noscript>` tags
  - Strip inline styles, data attributes, and tracking attributes
  - Collapse repetitive sibling structures (e.g., 50 identical list items → 2 examples + a count)
  - Preserve semantic landmarks: `<nav>`, `<main>`, `<header>`, `<footer>`, `<form>`, `<button>`, `<a>`, `<input>`
  - Preserve `id`, `class`, `role`, `aria-label`, `href`, `type`, `name`, `placeholder` attributes
- The pruned DOM is capped at a configurable token budget (default: ~8,000 tokens)
- A page metadata header is prepended: URL, page title, viewport dimensions

**Output format (sent to LLM):**

```
Page: "Order History — Acme Store"
URL: https://store.acme.com/account/orders
Viewport: 1440x900

<body>
  <header>
    <nav class="main-nav">
      <a href="/">Home</a>
      <a href="/account">Account</a>
      ...
    </nav>
  </header>
  <main id="content">
    <h1>Your Orders</h1>
    <div class="filters">...</div>
    <div class="order-card" data-repeated="47">
      <span class="order-id">#1234</span>
      <span class="order-date">Apr 20, 2026</span>
      <span class="order-total">$54.99</span>
      <button class="btn-details">View Details</button>
    </div>
  </main>
  <aside class="sidebar">...</aside>
</body>
```

### 5.3 LLM Integration

**What it is:** The bridge between the user's natural-language request and the generated CSS/JS modifications.

**System prompt strategy:**

The LLM receives a system prompt that:

1. Establishes its role: *"You are a UI modification assistant. You receive a description of a user's frustration with a webpage and a simplified DOM structure. You output CSS and JavaScript that modify the page to address the user's needs."*
2. Defines output format: structured JSON with `css` and `js` fields
3. Sets constraints:
   - Generated JS must not make network requests or access cookies/localStorage of the host page
   - Generated JS must not modify password or payment fields
   - Generated CSS/JS must be scoped to avoid breaking the host page's core functionality
   - Prefer CSS-only solutions when possible; use JS only when necessary
4. Includes the conversation history (prior turns) and the current accumulated modification state

**Request payload:**

```json
{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "DOM snapshot: ... \n\nCurrent modifications: ... \n\nUser request: Hide the sidebar and make the order cards bigger" },
    { "role": "assistant", "content": "{ css: '...', js: '...' }" }
  ]
}
```

**Response format (from LLM):**

```json
{
  "css": ".sidebar { display: none; } .order-card { font-size: 1.2em; padding: 20px; }",
  "js": "// optional JavaScript for functional changes",
  "explanation": "I've hidden the sidebar and increased the size of order cards for easier reading."
}
```

The `explanation` is displayed to the user in the chat thread so they understand what changed.

**API configuration:**

- Provider: configurable (Claude, OpenAI, etc.) — PoC defaults to Anthropic Claude
- API key: stored in `chrome.storage.local` (entered by user in a settings page)
- Model: configurable in settings, default to a capable but cost-efficient model

### 5.4 Modification Injection

**What it is:** The content script that applies AI-generated CSS and JS to the live page.

**Behavior:**

- CSS is injected via a `<style>` element with a unique ID (`customui-styles`) appended to `<head>`
- JS is executed via a sandboxed approach:
  - Wrap generated JS in an IIFE (Immediately Invoked Function Expression)
  - Prefix with `"use strict";`
  - Execute in the content script's isolated world (not the page's main world) where possible
  - For DOM manipulation that requires page-world access, use `chrome.scripting.executeScript` with `world: "MAIN"`
- Each new turn's modifications replace the previous ones (the LLM outputs the full accumulated state, not a diff)
- A visual flash/highlight briefly outlines modified elements so the user can see what changed

**Safety guardrails (PoC level):**

- Reject any generated JS containing: `fetch(`, `XMLHttpRequest`, `document.cookie`, `localStorage`, `eval(`, `Function(`
- Skip injection on URLs matching a blocklist: banking domains, password managers, email compose views
- Display a warning banner if the page appears to contain payment or login forms

### 5.5 Persistence & Auto-Apply

**What it is:** Saved modifications are automatically re-applied when the user revisits a matching page.

**Storage schema (chrome.storage.local):**

```json
{
  "customui_mods": {
    "store.acme.com/account/orders*": {
      "urlPattern": "store.acme.com/account/orders*",
      "displayName": "Acme Store — Clean Order View",
      "css": "...",
      "js": "...",
      "originalPrompt": "Hide the sidebar and make order cards bigger",
      "conversationHistory": [...],
      "createdAt": "2026-04-28T14:30:00Z",
      "updatedAt": "2026-04-28T14:35:00Z",
      "version": 1,
      "enabled": true
    }
  }
}
```

**Auto-apply flow:**

1. On every page load, the background service worker checks the URL against stored patterns
2. If a match is found and `enabled: true`, it injects the saved CSS/JS via the content script
3. A subtle badge or icon indicator shows that CustomUI modifications are active on this page
4. User can disable/re-enable per-site from the popup

**URL matching:**

- Use glob-style patterns with `*` wildcards
- The LLM suggests a URL pattern based on the page; the user can edit it
- Example: `store.acme.com/account/orders*` matches all order pages but not the homepage

### 5.6 Settings Page

**What it is:** An options page accessible from the extension popup (gear icon) or right-click → Options.

**Fields:**

- **API Provider:** dropdown (Anthropic Claude / OpenAI / Custom endpoint)
- **API Key:** password-masked input field
- **Model:** text input with sensible default
- **Saved Modifications:** list view with toggle (enable/disable), edit, and delete per entry
- **Blocklist:** domains where CustomUI will never activate (pre-populated with common banking/finance sites)

---

## 6. Technical Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Chrome Extension                    │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │   Popup UI   │  │  Background  │  │  Content     │ │
│  │  (Chat)      │◄─►│  Service     │◄─►│  Script      │ │
│  │              │  │  Worker       │  │  (per tab)   │ │
│  └─────────────┘  └──────┬───────┘  └─────────────┘ │
│                          │                            │
│                          │ API calls                  │
│                          ▼                            │
│                   ┌──────────────┐                    │
│                   │  Cloud LLM   │                    │
│                   │  (Claude)    │                    │
│                   └──────────────┘                    │
│                                                       │
│  Storage: chrome.storage.local                        │
│  ┌───────────────────────────────────────────────┐   │
│  │ API key │ Saved mods (per URL) │ Settings      │   │
│  └───────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

**Component responsibilities:**

- **Popup UI (popup.html / popup.js):** Renders the chat interface, sends user messages to the background worker, displays AI explanations, handles save/reset actions
- **Background Service Worker (background.js):** Orchestrates the flow — receives messages from popup, requests DOM from content script, calls the LLM API, sends generated code back to content script for injection, manages conversation state, handles auto-apply on navigation
- **Content Script (content.js):** Captures and prunes the DOM on request, injects/removes CSS and JS modifications, reports injection status back to background worker

---

## 7. Data Flow — Single Turn

```
1. User types message in popup
2. Popup → Background: { type: "user_message", text: "..." }
3. Background → Content Script: { type: "capture_dom" }
4. Content Script → Background: { type: "dom_snapshot", html: "..." }
5. Background constructs LLM prompt (system + history + DOM + user message)
6. Background → Cloud LLM API: POST /messages
7. Cloud LLM → Background: { css, js, explanation }
8. Background → Content Script: { type: "inject", css, js }
9. Content Script injects CSS/JS into page
10. Background → Popup: { type: "ai_response", explanation: "..." }
11. Popup renders explanation in chat thread
```

---

## 8. Known Risks & Mitigations

| Risk | Severity | Mitigation (PoC) | Future Solution |
|---|---|---|---|
| **DOM drift** — site updates break saved mods | Medium | Accept it; user can re-generate | "Self-healing" — re-run LLM with original intent + new DOM |
| **Token overflow** — large/complex pages exceed context | High | Aggressive DOM pruning + token cap | Chunked analysis; multi-pass summarization |
| **Unsafe JS injection** — generated code does something harmful | High | Keyword blocklist + domain blocklist | CSP-aware sandboxing; formal JS AST validation |
| **LLM hallucination** — targets selectors that don't exist | Medium | User sees the result immediately and can iterate | Selector validation before injection |
| **API cost** — heavy users burn through API credits | Low (BYOK) | User manages their own spend | Caching common modifications; local model option |
| **Popup closes mid-conversation** — state lost | Medium | Warn user; conversation is ephemeral until saved | Persist conversation to storage on each turn |
| **Page-world conflicts** — injected JS clashes with page JS | Medium | Use content script isolated world where possible | Shadow DOM isolation for injected UI elements |

---

## 9. PoC Scope — What's In and What's Out

### In Scope (build this)

- Chrome extension scaffolding (manifest v3)
- Popup chat UI with starter prompts and freeform input
- DOM capture and pruning engine
- LLM integration (Anthropic Claude API, BYOK)
- Multi-turn conversation with accumulated modification state
- CSS + JS injection into active tab
- Basic safety guardrails (keyword blocklist, domain blocklist)
- Persistence to chrome.storage.local with auto-apply on revisit
- Settings page for API key, saved modifications management
- Extension badge indicator when mods are active

### Out of Scope (future iterations)

- Cross-browser support (Firefox, Safari, Edge)
- Cloud sync / shareable modification "recipes"
- Local/on-device LLM option
- Marketplace for community-created modifications
- Self-healing modifications (auto-fix on DOM drift)
- Onboarding tutorial / guided walkthrough
- Analytics or usage tracking
- Chrome Web Store listing and review process
- Accessibility audit of generated modifications
- Multi-page workflow support (modifications that span a flow of pages)

---

## 10. Success Criteria (PoC)

The proof of concept is successful if:

1. **Core loop works end-to-end** — A user can describe a UI problem in plain language and see the page transform in response
2. **Multi-turn refinement works** — A user can say "also do X" and get incremental improvements without starting over
3. **Persistence works** — A saved modification auto-applies on page reload and revisit
4. **It works on 3+ real websites** — Tested on at least 3 meaningfully different sites (e.g., an e-commerce site, a SaaS dashboard, and a university portal)
5. **Non-technical user can operate it** — Someone unfamiliar with the tool can accomplish a task with minimal guidance

---

## 11. File Structure (Proposed)

```
customui-extension/
├── manifest.json              # Extension manifest (v3)
├── popup/
│   ├── popup.html             # Chat interface markup
│   ├── popup.css              # Chat interface styles
│   └── popup.js               # Chat logic, message handling
├── background/
│   └── background.js          # Service worker: orchestration, LLM calls, state
├── content/
│   └── content.js             # DOM capture, pruning, injection
├── options/
│   ├── options.html           # Settings page markup
│   ├── options.css            # Settings page styles
│   └── options.js             # Settings logic
├── utils/
│   ├── dom-pruner.js          # DOM summarization logic
│   ├── llm-client.js          # API client abstraction
│   ├── storage.js             # chrome.storage helpers
│   └── safety.js              # Guardrails and validation
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

---

## 12. Open Questions

1. **How aggressively should we prune the DOM?** There's a tradeoff between giving the LLM enough context to make good modifications and staying within token limits. Needs experimentation.
2. **Should the extension capture a screenshot alongside the DOM?** Multimodal models could benefit from seeing the visual layout, not just the structure. Adds complexity but might dramatically improve output quality.
3. **How to handle SPAs (Single Page Applications)?** Pages that don't do full reloads need a MutationObserver or navigation listener to re-apply modifications after client-side routing.
4. **What happens when a modification partially breaks a page?** Should there be an automatic rollback, or is manual "Reset" sufficient for PoC?
5. **Should we version modifications?** If a user re-generates modifications for the same site, do we keep history or overwrite?

---

## 13. Future Vision (Beyond PoC)

- **Shareable recipes** — Users publish their modifications as "recipes" that others can install with one click. *"Install 'Clean Gmail' by Sara — hides promotions, enlarges compose button"*
- **Self-healing mods** — When a site updates and modifications break, the tool automatically re-runs the LLM with the original intent against the new DOM
- **Cross-page workflows** — Modifications that understand multi-step flows (*"Make the entire checkout process one page"*)
- **Accessibility mode** — *"Make this page screen-reader friendly"* or *"Increase all contrast ratios to WCAG AA"*
- **Enterprise deployment** — Companies deploy standard UI modifications to all employees for internal tools
- **Local-first option** — Run a local model for users who don't want page content sent to the cloud
