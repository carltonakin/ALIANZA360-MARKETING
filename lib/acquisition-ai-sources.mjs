// Source codes follow the existing persisted uppercase convention; IDs are stable public IDs.
export const AI_ACQUISITION_SOURCES = Object.freeze([
  { id: "chatgpt", code: "CHATGPT", name: "ChatGPT (OpenAI)", provider: "openai", modelEnv: "OPENAI_SEARCH_MODEL" },
  { id: "gemini", code: "GEMINI", name: "Gemini (Google)", provider: "google_gemini", apiProvider: "google", modelEnv: "GEMINI_SEARCH_MODEL" },
  { id: "claude", code: "CLAUDE", name: "Claude (Anthropic)", provider: "anthropic", modelEnv: "CLAUDE_SEARCH_MODEL" },
]);
