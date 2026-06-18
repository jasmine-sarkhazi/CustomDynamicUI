// llm-client.js — LLM API abstraction
// Supports Anthropic Claude (default) and OpenAI-compatible endpoints.

const SYSTEM_PROMPT = `You are CustomUI, a UI modification assistant embedded in a Chrome extension.

You receive:
- A simplified snapshot of the current webpage's DOM
- The user's plain-language description of what they want to change
- The current accumulated CSS and JS modifications (if any)
- Prior conversation turns for context

You respond with JSON containing three fields:
{
  "css": "<complete CSS string — replaces any previous CSS>",
  "js": "<optional JavaScript string — replaces any previous JS>",
  "explanation": "<one or two sentence plain-language summary for the user>"
}

Rules:
- Output the FULL accumulated CSS/JS each turn (not a diff). Merge prior modifications with new ones.
- Prefer CSS-only solutions; use JS only when CSS cannot achieve the goal.
- Generated JS must NOT contain: fetch(, XMLHttpRequest, document.cookie, localStorage, eval(, Function(
- Do not modify <input type="password">, payment fields, or CSRF tokens.
- Scope CSS selectors precisely to avoid unintended side effects.
- The explanation must be written for a non-technical user — no CSS/JS jargon.
- If you cannot safely or usefully address the request, set css and js to empty strings and explain why.
- Respond ONLY with valid JSON. No markdown fences, no extra text.`;

export class LLMClient {
  constructor(settings) {
    this.provider = settings.provider ?? "anthropic";
    this.apiKey = settings.apiKey;
    this.model = settings.model ?? defaultModel(this.provider);
    this.endpoint = settings.customEndpoint ?? null;
  }

  async chat({ domSnapshot, pageContext, currentCss, currentJs, history, userMessage }) {
    const userContent = buildUserContent({ domSnapshot, pageContext, currentCss, currentJs, userMessage });
    const messages = buildMessages(history, userContent);

    const raw = this.provider === "openai" || this.endpoint
      ? await this.callOpenAI(messages)
      : await this.callAnthropic(messages);

    return parseResponse(raw);
  }

  // ── Anthropic ────────────────────────────────────────────────────────────

  async callAnthropic(messages) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Anthropic API error ${res.status}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  }

  // ── OpenAI-compatible ─────────────────────────────────────────────────────

  async callOpenAI(messages) {
    const url = this.endpoint ?? "https://api.openai.com/v1/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `API error ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function buildUserContent({ domSnapshot, pageContext, currentCss, currentJs, userMessage }) {
  const parts = [];

  parts.push(`Page: "${pageContext.title}"`);
  parts.push(`URL: ${pageContext.url}`);
  parts.push(`Viewport: ${pageContext.viewport}`);
  parts.push("");
  parts.push(domSnapshot);

  if (currentCss || currentJs) {
    parts.push("\n--- Current modifications ---");
    if (currentCss) parts.push(`CSS:\n${currentCss}`);
    if (currentJs) parts.push(`JS:\n${currentJs}`);
    parts.push("--- End current modifications ---");
  }

  parts.push(`\nUser request: ${userMessage}`);
  return parts.join("\n");
}

function buildMessages(history, userContent) {
  // Include prior assistant/user turns, but strip DOM snapshots from old user turns
  // to save tokens — keep only the user text portion.
  const trimmedHistory = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      if (m.role === "user") {
        // Strip everything before "User request:" to remove old DOM payloads
        const match = String(m.content).match(/User request:\s*([\s\S]+)$/);
        return { role: "user", content: match ? match[1] : m.content };
      }
      if (m.role === "assistant") {
        // The assistant content was already the parsed result object; re-serialize
        const c = m.content;
        return {
          role: "assistant",
          content: typeof c === "string" ? c : JSON.stringify(c),
        };
      }
      return m;
    });

  return [...trimmedHistory, { role: "user", content: userContent }];
}

function parseResponse(raw) {
  // Strip markdown fences if the model wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: try to extract JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("LLM returned non-JSON response");
  }
}

function defaultModel(provider) {
  if (provider === "openai") return "gpt-4o";
  return "claude-sonnet-4-6"; // Anthropic default
}
