// background.js — Service worker
// Orchestrates: DOM capture → LLM API → CSS/JS injection → persistence
//
// Message API (from popup.js):
//   { type: "get_state",    tabId, url }
//   { type: "user_message", tabId, url, text }
//   { type: "save_mods",    tabId, url }
//   { type: "reset_mods",   tabId }
//   { type: "toggle_mod",   tabId, url, enabled }
//
// Message API (from content.js):
//   { type: "dom_snapshot", html, url, title, viewport }
//   { type: "injection_done" }

import { LLMClient } from "../utils/llm-client.js";
import { Storage } from "../utils/storage.js";
import { isSensitivePage, buildUrlPattern } from "../utils/safety.js";

// Per-tab conversation state (ephemeral — lives in service worker memory)
// Map<tabId, { history: Message[], css: string, js: string }>
const tabState = new Map();

// ── Message router ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error("[CustomUI background] Error:", err);
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case "get_state":
      return getState(message.tabId, message.url);

    case "user_message":
      return handleUserMessage(message.tabId, message.url, message.text);

    case "save_mods":
      return saveMods(message.tabId, message.url);

    case "reset_mods":
      return resetMods(message.tabId);

    case "toggle_mod":
      return toggleMod(message.url, message.enabled);

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

// ── get_state ─────────────────────────────────────────────────────────────

async function getState(tabId, url) {
  const state = tabState.get(tabId);
  const savedMod = url ? await Storage.findModForUrl(url) : null;
  const sensitivePageWarning = url ? isSensitivePage(url) : false;

  return {
    hasModifications: !!(state?.css || state?.js),
    conversationHistory: state?.history ?? [],
    savedMod: savedMod ?? null,
    sensitivePageWarning,
  };
}

// ── user_message ──────────────────────────────────────────────────────────

async function handleUserMessage(tabId, url, text) {
  if (isSensitivePage(url)) {
    return { error: "CustomUI is disabled on this page for security reasons." };
  }

  // 1. Capture DOM from content script
  const domSnapshot = await captureDOM(tabId);
  if (domSnapshot.error) return { error: domSnapshot.error };

  // 2. Build / retrieve conversation state
  if (!tabState.has(tabId)) {
    tabState.set(tabId, { history: [], css: "", js: "" });
  }
  const state = tabState.get(tabId);

  // 3. Call LLM
  const settings = await Storage.getSettings();
  if (!settings.apiKey) {
    return { error: "No API key configured. Open Settings to add your key." };
  }

  const client = new LLMClient(settings);
  const result = await client.chat({
    domSnapshot: domSnapshot.html,
    pageContext: {
      url: domSnapshot.url,
      title: domSnapshot.title,
      viewport: domSnapshot.viewport,
    },
    currentCss: state.css,
    currentJs: state.js,
    history: state.history,
    userMessage: text,
  });

  // 4. Update state
  state.history.push({ role: "user", content: text });
  state.history.push({ role: "assistant", content: result });
  state.css = result.css ?? "";
  state.js = result.js ?? "";

  // 5. Inject into page
  await injectMods(tabId, state.css, state.js);

  return { explanation: result.explanation ?? "Done." };
}

// ── save_mods ─────────────────────────────────────────────────────────────

async function saveMods(tabId, url) {
  const state = tabState.get(tabId);
  if (!state || (!state.css && !state.js)) {
    return { error: "Nothing to save." };
  }

  const urlPattern = buildUrlPattern(url);
  const firstUserMsg = state.history.find((m) => m.role === "user")?.content ?? "";
  const displayName = await generateDisplayName(url, firstUserMsg);

  const mod = {
    urlPattern,
    displayName,
    css: state.css,
    js: state.js,
    originalPrompt: firstUserMsg,
    conversationHistory: state.history,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    enabled: true,
  };

  await Storage.saveMod(urlPattern, mod);
  return { success: true, displayName };
}

// ── reset_mods ────────────────────────────────────────────────────────────

async function resetMods(tabId) {
  tabState.delete(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "remove_mods" }).catch(() => {});
  return { success: true };
}

// ── toggle_mod ────────────────────────────────────────────────────────────

async function toggleMod(url, enabled) {
  const mod = await Storage.findModForUrl(url);
  if (!mod) return { error: "No saved modification found for this URL." };

  mod.enabled = enabled;
  mod.updatedAt = new Date().toISOString();
  await Storage.saveMod(mod.urlPattern, mod);
  return { success: true };
}

// ── Auto-apply on navigation ──────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  // Clear ephemeral state when navigating away
  const existing = tabState.get(tabId);
  if (existing) tabState.delete(tabId);

  // Check for saved mod
  const mod = await Storage.findModForUrl(tab.url);
  if (!mod || !mod.enabled) {
    await chrome.action.setBadgeText({ text: "", tabId });
    return;
  }

  await injectMods(tabId, mod.css, mod.js);
  await chrome.action.setBadgeText({ text: "●", tabId });
  await chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId });
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "ping" });
    if (pong?.ready) return true;
  } catch {
    // Content script not present — fall through to inject.
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content.js"],
    });
    return true;
  } catch (err) {
    console.warn("[CustomUI background] Could not inject content script:", err.message);
    return false;
  }
}

async function captureDOM(tabId) {
  const ready = await ensureContentScript(tabId);
  if (!ready) {
    return { error: "CustomUI can't run on this page (try a regular http(s) page)." };
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "capture_dom" });
    return response ?? { error: "No response from content script" };
  } catch (err) {
    return { error: err.message };
  }
}

async function injectMods(tabId, css, js) {
  const ready = await ensureContentScript(tabId);
  if (!ready) return;
  await chrome.tabs.sendMessage(tabId, { type: "inject_mods", css, js }).catch((err) => {
    console.warn("[CustomUI background] inject_mods failed:", err.message);
  });
}

function generateDisplayName(url, prompt) {
  // Simple heuristic — can be replaced with an LLM call later
  try {
    const { hostname, pathname } = new URL(url);
    const site = hostname.replace(/^www\./, "");
    const path = pathname.split("/").filter(Boolean).slice(0, 2).join(" › ");
    return path ? `${site} — ${path}` : site;
  } catch {
    return prompt.slice(0, 40) || "Saved modification";
  }
}
