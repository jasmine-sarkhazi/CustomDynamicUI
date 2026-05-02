// storage.js — chrome.storage.local helpers

const MODS_KEY = "customui_mods";
const SETTINGS_KEY = "customui_settings";

export const Storage = {

  // ── Modifications ─────────────────────────────────────────────────────

  async getAllMods() {
    const result = await chrome.storage.local.get(MODS_KEY);
    return result[MODS_KEY] ?? {};
  },

  async saveMod(urlPattern, mod) {
    const mods = await this.getAllMods();
    mods[urlPattern] = mod;
    await chrome.storage.local.set({ [MODS_KEY]: mods });
  },

  async deleteMod(urlPattern) {
    const mods = await this.getAllMods();
    delete mods[urlPattern];
    await chrome.storage.local.set({ [MODS_KEY]: mods });
  },

  /**
   * Find the best-matching saved modification for a given URL.
   * Patterns use glob-style `*` wildcards.
   * @param {string} url
   * @returns {object|null}
   */
  async findModForUrl(url) {
    const mods = await this.getAllMods();
    let bestMatch = null;
    let bestScore = -1;

    for (const [pattern, mod] of Object.entries(mods)) {
      const score = matchGlob(pattern, url);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = mod;
      }
    }

    return bestMatch;
  },

  // ── Settings ──────────────────────────────────────────────────────────

  async getSettings() {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return result[SETTINGS_KEY] ?? defaultSettings();
  },

  async saveSettings(settings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  },

  async updateSettings(partial) {
    const current = await this.getSettings();
    await this.saveSettings({ ...current, ...partial });
  },
};

// ── Glob matching ─────────────────────────────────────────────────────────

/**
 * Match a glob pattern (with `*` wildcards) against a URL.
 * Returns a specificity score (higher = more specific match) or -1 for no match.
 * Pattern can omit protocol: "store.acme.com/account/orders*"
 */
function matchGlob(pattern, url) {
  try {
    const { hostname, pathname } = new URL(url);
    const normalized = hostname + pathname;
    const regex = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
    );
    if (!regex.test(normalized)) return -1;
    // More specific patterns (fewer wildcards, longer) score higher
    return pattern.replace(/\*/g, "").length;
  } catch {
    return -1;
  }
}

function defaultSettings() {
  return {
    provider: "anthropic",
    apiKey: "",
    model: "claude-sonnet-4-6",
    customEndpoint: "",
    blocklist: [
      "bankofamerica.com",
      "chase.com",
      "wellsfargo.com",
      "citi.com",
      "paypal.com",
      "venmo.com",
      "stripe.com",
    ],
  };
}
