// dom-pruner.js — Produces a token-efficient DOM snapshot for the LLM

const TOKEN_BUDGET = 8000; // approximate target
const KEEP_ATTRS = new Set(["id", "class", "role", "aria-label", "href", "type", "name", "placeholder", "for", "action", "method"]);
const REMOVE_TAGS = new Set(["script", "style", "svg", "noscript", "iframe", "canvas", "video", "audio", "link", "meta"]);
const SEMANTIC_TAGS = new Set(["nav", "main", "header", "footer", "form", "section", "article", "aside", "button", "a", "input", "select", "textarea", "label", "h1", "h2", "h3", "h4", "h5", "h6"]);
const MAX_REPETITIONS = 2; // collapse after this many identical sibling structures

/**
 * Prune a cloned document element and return a compact HTML string.
 * @param {Element} root - cloned documentElement
 * @returns {string}
 */
export function pruneDom(root) {
  removeUnwantedNodes(root);
  stripAttributes(root);
  collapseRepetitions(root);
  removeHiddenElements(root);

  const body = root.querySelector("body") ?? root;
  let html = serializeNode(body);
  return truncateToTokenBudget(html, TOKEN_BUDGET);
}

// ── Passes ────────────────────────────────────────────────────────────────

function removeUnwantedNodes(root) {
  REMOVE_TAGS.forEach((tag) => {
    root.querySelectorAll(tag).forEach((el) => el.remove());
  });
  // Remove comment nodes
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

    // Truncate very long class strings
    if (el.className && typeof el.className === "string" && el.className.length > 80) {
      el.setAttribute("class", el.className.split(" ").slice(0, 5).join(" ") + "…");
    }
  });
}

function removeHiddenElements(root) {
  // Remove elements that are hidden via common patterns
  // (we can't reliably use getComputedStyle on a clone, so use attribute heuristics)
  root.querySelectorAll('[aria-hidden="true"], [hidden], [type="hidden"]').forEach((el) => {
    el.remove();
  });
}

function collapseRepetitions(root) {
  root.querySelectorAll("*").forEach((parent) => {
    const children = Array.from(parent.children);
    if (children.length <= MAX_REPETITIONS) return;

    // Group children by tag + class fingerprint
    const fingerprint = (el) => `${el.tagName}|${el.className}`;
    const firstFp = fingerprint(children[0]);
    const allSame = children.every((c) => fingerprint(c) === firstFp);

    if (allSame && children.length > MAX_REPETITIONS) {
      const kept = children.slice(0, MAX_REPETITIONS);
      const removed = children.slice(MAX_REPETITIONS);
      removed.forEach((c) => c.remove());

      // Annotate with count
      kept[kept.length - 1].setAttribute("data-repeated", children.length);
    }
  });
}

// ── Serializer ────────────────────────────────────────────────────────────

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

  // Self-closing elements
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

// ── Token budget ──────────────────────────────────────────────────────────

function truncateToTokenBudget(html, budget) {
  // Rough estimate: 1 token ≈ 4 characters
  const charLimit = budget * 4;
  if (html.length <= charLimit) return html;

  // Truncate and close any open tags
  let truncated = html.slice(0, charLimit);
  truncated += "\n<!-- [DOM truncated to fit token budget] -->";
  return truncated;
}
