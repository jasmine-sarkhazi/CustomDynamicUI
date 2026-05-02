// content.js — Content script (runs in every tab)
// Responsibilities:
//   1. Capture + prune the page DOM on request
//   2. Inject / remove CSS and JS modifications
//   3. Flash-highlight modified elements
//
// NOTE: MV3 content scripts do not support ES module imports, so the DOM
// pruner and JS validator are inlined below. The same logic lives in
// utils/dom-pruner.js and utils/safety.js for use by the service worker
// and options page (which DO support modules).

(function () {
  "use strict";

  // ── Constants ────────────────────────────────────────────────────────────

  const STYLE_ID = "customui-styles";
  const SCRIPT_ID = "customui-script";
  const FLASH_STYLE_ID = "customui-flash-styles";

  const TOKEN_BUDGET = 8000;
  const KEEP_ATTRS = new Set(["id", "class", "role", "aria-label", "href", "type", "name", "placeholder", "for", "action", "method"]);
  const REMOVE_TAGS = new Set(["script", "style", "svg", "noscript", "iframe", "canvas", "video", "audio", "link", "meta"]);
  const SEMANTIC_TAGS = new Set(["nav", "main", "header", "footer", "form", "section", "article", "aside", "button", "a", "input", "select", "textarea", "label", "h1", "h2", "h3", "h4", "h5", "h6"]);
  const MAX_REPETITIONS = 2;

  const BLOCKED_JS_PATTERNS = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bdocument\.cookie\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\beval\s*\(/,
    /\bnew\s+Function\b/,
    /\bFunction\s*\(/,
    /\bimportScripts\b/,
    /\bnavigator\.sendBeacon\b/,
  ];

  // ── Message router ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case "capture_dom":
        sendResponse(captureDOM());
        break;

      case "inject_mods":
        injectMods(message.css ?? "", message.js ?? "");
        sendResponse({ success: true });
        break;

      case "remove_mods":
        removeMods();
        sendResponse({ success: true });
        break;

      case "ping":
        sendResponse({ ready: true });
        break;

      default:
        sendResponse({ error: `Unknown message type: ${message.type}` });
    }
    return false;
  });

  // ── DOM capture ──────────────────────────────────────────────────────────

  function captureDOM() {
    try {
      const sensitiveFields = hasSensitiveFields(document);
      const pruned = pruneDom(document.documentElement.cloneNode(true));
      return {
        html: pruned,
        url: location.href,
        title: document.title,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        sensitiveFields,
      };
    } catch (err) {
      return { error: `DOM capture failed: ${err.message}` };
    }
  }

  function hasSensitiveFields(doc) {
    return !!(
      doc.querySelector('input[type="password"]') ||
      doc.querySelector('input[autocomplete*="cc-"]') ||
      doc.querySelector('input[autocomplete="current-password"]') ||
      doc.querySelector('input[name*="card"]') ||
      doc.querySelector('input[name*="cvv"]')
    );
  }

  // ── DOM pruner ───────────────────────────────────────────────────────────

  function pruneDom(root) {
    removeUnwantedNodes(root);
    stripAttributes(root);
    collapseRepetitions(root);
    removeHiddenElements(root);

    const body = root.querySelector("body") ?? root;
    const html = serializeNode(body);
    return truncateToTokenBudget(html, TOKEN_BUDGET);
  }

  function removeUnwantedNodes(root) {
    REMOVE_TAGS.forEach((tag) => {
      root.querySelectorAll(tag).forEach((el) => el.remove());
    });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach((c) => c.remove());
  }

  function stripAttributes(root) {
    root.querySelectorAll("*").forEach((el) => {
      const toRemove = [];
      for (const attr of el.attributes) {
        if (!KEEP_ATTRS.has(attr.name)) toRemove.push(attr.name);
      }
      toRemove.forEach((a) => el.removeAttribute(a));

      if (el.className && typeof el.className === "string" && el.className.length > 80) {
        el.setAttribute("class", el.className.split(" ").slice(0, 5).join(" ") + "…");
      }
    });
  }

  function removeHiddenElements(root) {
    root.querySelectorAll('[aria-hidden="true"], [hidden], [type="hidden"]').forEach((el) => el.remove());
  }

  function collapseRepetitions(root) {
    root.querySelectorAll("*").forEach((parent) => {
      const children = Array.from(parent.children);
      if (children.length <= MAX_REPETITIONS) return;

      const fingerprint = (el) => `${el.tagName}|${el.className}`;
      const firstFp = fingerprint(children[0]);
      const allSame = children.every((c) => fingerprint(c) === firstFp);

      if (allSame) {
        const kept = children.slice(0, MAX_REPETITIONS);
        const removed = children.slice(MAX_REPETITIONS);
        removed.forEach((c) => c.remove());
        kept[kept.length - 1].setAttribute("data-repeated", String(children.length));
      }
    });
  }

  function serializeNode(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      return text ? text.slice(0, 200) : "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    const attrs = serializeAttrs(node);
    const indent = "  ".repeat(depth);
    const childDepth = depth + 1;

    if (["input", "br", "hr", "img"].includes(tag)) {
      return `${indent}<${tag}${attrs} />`;
    }

    const childrenHtml = Array.from(node.childNodes)
      .map((c) => serializeNode(c, childDepth))
      .filter(Boolean)
      .join("\n");

    if (!childrenHtml && !SEMANTIC_TAGS.has(tag) && depth > 2) return "";

    const open = `${indent}<${tag}${attrs}>`;
    const close = `</${tag}>`;
    if (!childrenHtml) return `${open}${close}`;
    return `${open}\n${childrenHtml}\n${indent}${close}`;
  }

  function serializeAttrs(el) {
    const parts = [];
    for (const attr of el.attributes) {
      if (KEEP_ATTRS.has(attr.name) && attr.value) {
        const val = attr.value.length > 80 ? attr.value.slice(0, 80) + "…" : attr.value;
        parts.push(`${attr.name}="${escapeAttr(val)}"`);
      }
    }
    if (el.hasAttribute("data-repeated")) {
      parts.push(`data-repeated="${el.getAttribute("data-repeated")}"`);
    }
    return parts.length ? " " + parts.join(" ") : "";
  }

  function escapeAttr(str) {
    return str.replace(/"/g, "&quot;");
  }

  function truncateToTokenBudget(html, budget) {
    const charLimit = budget * 4;
    if (html.length <= charLimit) return html;
    return html.slice(0, charLimit) + "\n<!-- [DOM truncated to fit token budget] -->";
  }

  // ── Injection ────────────────────────────────────────────────────────────

  function injectMods(css, js) {
    injectCSS(css);
    if (js) {
      const jsError = validateJs(js);
      if (jsError) {
        console.warn("[CustomUI] Blocked unsafe JS:", jsError);
      } else {
        injectJS(js);
      }
    }
    flashModifiedElements();
  }

  function injectCSS(css) {
    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
  }

  function injectJS(js) {
    document.getElementById(SCRIPT_ID)?.remove();
    const scriptEl = document.createElement("script");
    scriptEl.id = SCRIPT_ID;
    scriptEl.textContent = `"use strict"; (function() {\n${js}\n})();`;
    (document.head ?? document.documentElement).appendChild(scriptEl);
  }

  function removeMods() {
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(SCRIPT_ID)?.remove();
    document.getElementById(FLASH_STYLE_ID)?.remove();
  }

  function validateJs(js) {
    if (!js || typeof js !== "string") return null;
    for (const pattern of BLOCKED_JS_PATTERNS) {
      if (pattern.test(js)) return `Blocked pattern: ${pattern.source}`;
    }
    return null;
  }

  // ── Flash highlight ──────────────────────────────────────────────────────

  function flashModifiedElements() {
    let flashStyle = document.getElementById(FLASH_STYLE_ID);
    if (!flashStyle) {
      flashStyle = document.createElement("style");
      flashStyle.id = FLASH_STYLE_ID;
      flashStyle.textContent = `
        @keyframes customui-flash {
          0%   { outline: 2px solid rgba(91, 76, 245, 0.8); outline-offset: 2px; }
          100% { outline: 2px solid rgba(91, 76, 245, 0); outline-offset: 4px; }
        }
        .customui-flash-target { animation: customui-flash 0.8s ease-out forwards; }
      `;
      document.head.appendChild(flashStyle);
    }

    const styleEl = document.getElementById(STYLE_ID);
    if (!styleEl?.textContent) return;

    const selectors = [];
    const rules = styleEl.textContent.match(/[^{}]+(?=\{)/g) ?? [];
    rules.forEach((sel) => {
      const cleaned = sel.trim();
      if (cleaned && !cleaned.startsWith("@")) selectors.push(cleaned);
    });

    selectors.slice(0, 10).forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          el.classList.remove("customui-flash-target");
          void el.offsetWidth;
          el.classList.add("customui-flash-target");
          el.addEventListener(
            "animationend",
            () => el.classList.remove("customui-flash-target"),
            { once: true }
          );
        });
      } catch {
        /* invalid selector — skip */
      }
    });
  }

  // ── Mark content script as loaded ────────────────────────────────────────

  window.__customUiContentReady = true;
})();
