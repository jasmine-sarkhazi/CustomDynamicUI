// safety.js — Guardrails and validation

// JS patterns that are never allowed in generated code
const BLOCKED_JS_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bdocument\.cookie\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bIndexedDB\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bnew\s+Function\b/,
  /\bimportScripts\b/,
  /\bwindow\.open\b/,
  /\blocation\s*=/,
  /\blocation\.href\s*=/,
  /\blocation\.replace\s*\(/,
  /\bnavigator\.sendBeacon\b/,
];

// Domains where CustomUI will never activate
const DEFAULT_BLOCKLIST = [
  "bankofamerica.com",
  "chase.com",
  "wellsfargo.com",
  "citibank.com",
  "citi.com",
  "paypal.com",
  "venmo.com",
  "stripe.com",
  "squareup.com",
  "braintreepayments.com",
  "adyen.com",
];

// Patterns that suggest a sensitive page (login / payment)
const SENSITIVE_PAGE_PATTERNS = [
  /\/login/i,
  /\/signin/i,
  /\/sign-in/i,
  /\/checkout/i,
  /\/payment/i,
  /\/billing/i,
  /\/bank/i,
  /\/password/i,
];

/**
 * Validate generated JavaScript.
 * @param {string} js
 * @returns {string|null} error message if blocked, null if safe
 */
export function validateJs(js) {
  if (!js || typeof js !== "string") return null;

  for (const pattern of BLOCKED_JS_PATTERNS) {
    if (pattern.test(js)) {
      return `Blocked pattern detected: ${pattern.source}`;
    }
  }
  return null;
}

/**
 * Check whether CustomUI should be disabled on a given URL.
 * Checks against the built-in blocklist; callers should also check
 * the user's custom blocklist from Storage.getSettings().blocklist.
 * @param {string} url
 * @returns {boolean}
 */
export function isSensitivePage(url) {
  if (!url) return false;
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, "");

    if (DEFAULT_BLOCKLIST.some((d) => host === d || host.endsWith("." + d))) {
      return true;
    }

    if (SENSITIVE_PAGE_PATTERNS.some((p) => p.test(pathname))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check whether a page may contain sensitive form fields
 * (shows a warning but does NOT block).
 * @param {Document} doc
 * @returns {boolean}
 */
export function hasSensitiveFields(doc) {
  return !!(
    doc.querySelector('input[type="password"]') ||
    doc.querySelector('input[autocomplete*="cc-"]') ||
    doc.querySelector('input[autocomplete="current-password"]') ||
    doc.querySelector('input[name*="card"]') ||
    doc.querySelector('input[name*="cvv"]')
  );
}

/**
 * Build a glob-style URL pattern from a full URL.
 * Example: https://store.acme.com/account/orders/1234 → store.acme.com/account/orders*
 * @param {string} url
 * @returns {string}
 */
export function buildUrlPattern(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const segments = pathname.split("/").filter(Boolean);

    // Strip the last segment if it looks like an ID (numeric or UUID)
    const lastSeg = segments[segments.length - 1];
    if (lastSeg && /^[\d\-a-f]{4,}$/i.test(lastSeg)) {
      segments.pop();
    }

    const base = hostname + (segments.length ? "/" + segments.join("/") : "");
    return base + "*";
  } catch {
    return url;
  }
}
