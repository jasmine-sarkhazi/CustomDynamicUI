// popup.js — Chat interface logic
// Communicates with background.js via chrome.runtime.sendMessage

const chatThread = document.getElementById("chat-thread");
const welcome = document.getElementById("welcome");
const messageInput = document.getElementById("message-input");
const btnSend = document.getElementById("btn-send");
const btnSave = document.getElementById("btn-save");
const btnReset = document.getElementById("btn-reset");
const btnSettings = document.getElementById("btn-settings");
const actionBar = document.getElementById("action-bar");
const typingIndicator = document.getElementById("typing-indicator");
const statusBar = document.getElementById("status-bar");
const statusText = document.getElementById("status-text");
const toggleEnabled = document.getElementById("toggle-enabled");
const warningBanner = document.getElementById("warning-banner");
const activeBadge = document.getElementById("active-badge");

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Load existing state for this tab from background
  const response = await sendToBackground({ type: "get_state", tabId: tab.id });

  if (response?.savedMod) {
    showStatusBar(response.savedMod.displayName, response.savedMod.enabled);
    activeBadge.classList.remove("hidden");
  }

  if (response?.hasModifications) {
    actionBar.classList.remove("hidden");
    hideWelcome();
    renderHistory(response.conversationHistory ?? []);
  }

  if (response?.sensitivePageWarning) {
    warningBanner.classList.remove("hidden");
  }
}

init();

// ── Input handling ────────────────────────────────────────────────────────

messageInput.addEventListener("input", () => {
  btnSend.disabled = messageInput.value.trim().length === 0;
  autoResizeTextarea();
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!btnSend.disabled) sendMessage();
  }
});

btnSend.addEventListener("click", sendMessage);

document.querySelectorAll(".starter-prompt").forEach((btn) => {
  btn.addEventListener("click", () => {
    messageInput.value = btn.dataset.prompt;
    btnSend.disabled = false;
    messageInput.focus();
  });
});

// ── Send message ──────────────────────────────────────────────────────────

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = "";
  btnSend.disabled = true;
  autoResizeTextarea();
  hideWelcome();

  appendMessage("user", text);
  showTyping();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const response = await sendToBackground({
      type: "user_message",
      text,
      tabId: tab.id,
      url: tab.url,
    });

    hideTyping();

    if (response?.error) {
      appendMessage("ai", `Error: ${response.error}`);
      return;
    }

    appendMessage("ai", response.explanation ?? "Done — check the page.");
    actionBar.classList.remove("hidden");
    activeBadge.classList.remove("hidden");
  } catch (err) {
    hideTyping();
    appendMessage("ai", `Something went wrong: ${err.message}`);
  }
}

// ── Save / Reset ──────────────────────────────────────────────────────────

btnSave.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  btnSave.disabled = true;
  btnSave.textContent = "Saving…";

  try {
    const response = await sendToBackground({ type: "save_mods", tabId: tab.id, url: tab.url });
    if (response?.success) {
      btnSave.textContent = "Saved!";
      showStatusBar(response.displayName, true);
      setTimeout(() => {
        btnSave.textContent = "Save for this page";
        btnSave.disabled = false;
      }, 1500);
    } else {
      throw new Error(response?.error ?? "Unknown error");
    }
  } catch (err) {
    btnSave.textContent = "Save for this page";
    btnSave.disabled = false;
    appendMessage("ai", `Could not save: ${err.message}`);
  }
});

btnReset.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await sendToBackground({ type: "reset_mods", tabId: tab.id });

  chatThread.innerHTML = "";
  chatThread.appendChild(welcome);
  welcome.classList.remove("hidden");
  actionBar.classList.add("hidden");
  activeBadge.classList.add("hidden");
  statusBar.classList.add("hidden");
});

// ── Settings ──────────────────────────────────────────────────────────────

btnSettings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// ── Saved mod toggle ──────────────────────────────────────────────────────

toggleEnabled.addEventListener("change", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await sendToBackground({
    type: "toggle_mod",
    tabId: tab.id,
    url: tab.url,
    enabled: toggleEnabled.checked,
  });
});

// ── UI helpers ────────────────────────────────────────────────────────────

function appendMessage(role, text) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "CustomUI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  msg.appendChild(label);
  msg.appendChild(bubble);
  chatThread.appendChild(msg);
  chatThread.scrollTop = chatThread.scrollHeight;
}

function renderHistory(history) {
  history.forEach(({ role, content }) => {
    if (role === "user" || role === "assistant") {
      const displayRole = role === "assistant" ? "ai" : "user";
      const text = typeof content === "string" ? content : content?.explanation ?? "";
      if (text) appendMessage(displayRole, text);
    }
  });
}

function hideWelcome() {
  welcome.classList.add("hidden");
}

function showTyping() {
  typingIndicator.classList.remove("hidden");
  chatThread.scrollTop = chatThread.scrollHeight;
}

function hideTyping() {
  typingIndicator.classList.add("hidden");
}

function showStatusBar(displayName, enabled) {
  statusText.textContent = displayName
    ? `"${displayName}" active`
    : "Modifications active for this page";
  toggleEnabled.checked = enabled;
  statusBar.classList.remove("hidden");
}

function autoResizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 100)}px`;
}

// ── Background messaging helper ───────────────────────────────────────────

function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}
