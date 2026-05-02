// options.js — Settings page logic

import { Storage } from "../utils/storage.js";

// ── Elements ──────────────────────────────────────────────────────────────

const providerSelect = document.getElementById("provider");
const apiKeyInput = document.getElementById("api-key");
const btnToggleKey = document.getElementById("btn-toggle-key");
const modelInput = document.getElementById("model");
const customEndpointInput = document.getElementById("custom-endpoint");
const fieldCustomEndpoint = document.getElementById("field-custom-endpoint");
const btnSaveApi = document.getElementById("btn-save-api");
const apiSaveStatus = document.getElementById("api-save-status");

const modsList = document.getElementById("mods-list");
const modsEmptyHint = document.getElementById("mods-empty-hint");

const blocklistInput = document.getElementById("blocklist-input");
const btnSaveBlocklist = document.getElementById("btn-save-blocklist");
const blocklistSaveStatus = document.getElementById("blocklist-save-status");

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  const settings = await Storage.getSettings();
  providerSelect.value = settings.provider ?? "anthropic";
  apiKeyInput.value = settings.apiKey ?? "";
  modelInput.value = settings.model ?? "";
  customEndpointInput.value = settings.customEndpoint ?? "";
  blocklistInput.value = (settings.blocklist ?? []).join("\n");

  toggleCustomEndpointField();
  await renderMods();
}

init();

// ── API settings ──────────────────────────────────────────────────────────

providerSelect.addEventListener("change", toggleCustomEndpointField);

function toggleCustomEndpointField() {
  fieldCustomEndpoint.style.display =
    providerSelect.value === "custom" ? "block" : "none";
}

btnToggleKey.addEventListener("click", () => {
  const isHidden = apiKeyInput.type === "password";
  apiKeyInput.type = isHidden ? "text" : "password";
  btnToggleKey.textContent = isHidden ? "Hide" : "Show";
});

btnSaveApi.addEventListener("click", async () => {
  await Storage.updateSettings({
    provider: providerSelect.value,
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
    customEndpoint: customEndpointInput.value.trim(),
  });
  showStatus(apiSaveStatus);
});

// ── Blocklist ─────────────────────────────────────────────────────────────

btnSaveBlocklist.addEventListener("click", async () => {
  const lines = blocklistInput.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  await Storage.updateSettings({ blocklist: lines });
  showStatus(blocklistSaveStatus);
});

// ── Saved modifications ───────────────────────────────────────────────────

async function renderMods() {
  const mods = await Storage.getAllMods();
  const entries = Object.entries(mods);

  modsList.innerHTML = "";

  if (entries.length === 0) {
    modsEmptyHint.classList.remove("hidden");
    return;
  }

  modsEmptyHint.classList.add("hidden");

  entries.forEach(([pattern, mod]) => {
    const li = document.createElement("li");
    li.className = "mod-item";
    li.dataset.pattern = pattern;

    li.innerHTML = `
      <div class="mod-info">
        <div class="mod-name">${escapeHtml(mod.displayName ?? pattern)}</div>
        <div class="mod-pattern">${escapeHtml(pattern)}</div>
      </div>
      <div class="mod-actions">
        <label class="toggle" title="${mod.enabled ? "Disable" : "Enable"}">
          <input type="checkbox" class="mod-toggle" ${mod.enabled ? "checked" : ""} />
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-delete" data-pattern="${escapeHtml(pattern)}">Delete</button>
      </div>
    `;

    li.querySelector(".mod-toggle").addEventListener("change", async (e) => {
      mod.enabled = e.target.checked;
      mod.updatedAt = new Date().toISOString();
      await Storage.saveMod(pattern, mod);
    });

    li.querySelector(".btn-delete").addEventListener("click", async () => {
      if (confirm(`Delete modifications for "${mod.displayName ?? pattern}"?`)) {
        await Storage.deleteMod(pattern);
        li.remove();
        const remaining = modsList.querySelectorAll(".mod-item");
        if (remaining.length === 0) modsEmptyHint.classList.remove("hidden");
      }
    });

    modsList.appendChild(li);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function showStatus(el) {
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
