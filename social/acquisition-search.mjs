export const ACQUISITION_SEARCH_PROVIDERS = Object.freeze([
  { id: "openai", label: "ChatGPT", code: "OPENAI", key: "OPENAI_API_KEY", model: "OPENAI_MODEL" },
  { id: "google", label: "Gemini", code: "GOOGLE_GEMINI", key: "GEMINI_API_KEY", model: "GEMINI_MODEL" },
  { id: "anthropic", label: "Claude", code: "ANTHROPIC", key: "ANTHROPIC_API_KEY", model: "ANTHROPIC_MODEL" },
]);

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const safeUrl = (value) => {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
};

export class AcquisitionSearchService {
  constructor({ repository, encryptionKey, env = process.env, fetchImpl = globalThis.fetch } = {}) {
    Object.assign(this, { repository, encryptionKey, env, fetchImpl });
  }

  async search(input, { modelEnv = null, requireWebSearch = false, maximumQueryLength = 4000 } = {}) {
    const provider = ACQUISITION_SEARCH_PROVIDERS.find((item) => item.id === input?.provider);
    if (!provider) throw fail("Select ChatGPT, Gemini, or Claude.");
    if (typeof input.query !== "string" || !input.query.trim() || input.query.length > maximumQueryLength) {
      throw fail(`Enter a search query between 1 and ${maximumQueryLength.toLocaleString("en-US")} characters.`);
    }
    const query = input.query.trim();
    const saved = typeof this.repository?.getAiProviderConfigurations === "function"
      ? (await this.repository.getAiProviderConfigurations({ encryptionKey: this.encryptionKey, enabledOnly: true }))
        .find((item) => item.providerCode === provider.code && item.enabled) : null;
    const apiKey = saved?.secrets?.apiKey || this.env[provider.key];
    const model = (modelEnv && this.env[modelEnv]) || this.env[`ACQUISITION_${provider.id.toUpperCase()}_MODEL`] || saved?.model || this.env[provider.model];
    if (!apiKey) throw fail(`${provider.label} is not configured. Add its API key in AI Configuration or set ${provider.key} on the server.`, 409);
    if (!model) throw fail(`Set a model in AI Configuration or ${provider.model} on the server for ${provider.label}.`, 409);
    const webEnabled = this.env[`ACQUISITION_${provider.id.toUpperCase()}_WEB_SEARCH`] === "true";
    if (requireWebSearch && !webEnabled) throw fail(`${provider.label} discovery requires ACQUISITION_${provider.id.toUpperCase()}_WEB_SEARCH=true and a search-capable model (${modelEnv}).`, 409);
    let url, headers, body;
    if (provider.id === "openai") {
      url = "https://api.openai.com/v1/responses";
      headers = { authorization: `Bearer ${apiKey}` };
      body = { model, input: query, store: false, max_output_tokens: 3000, ...(webEnabled ? { tools: [{ type: "web_search" }] } : {}) };
    } else if (provider.id === "google") {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      headers = { "x-goog-api-key": apiKey };
      body = { contents: [{ role: "user", parts: [{ text: query }] }], generationConfig: { maxOutputTokens: 3000 }, ...(webEnabled ? { tools: [{ google_search: {} }] } : {}) };
    } else {
      url = "https://api.anthropic.com/v1/messages";
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
      body = { model, max_tokens: 3000, messages: [{ role: "user", content: query }], ...(webEnabled ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] } : {}) };
    }
    let data;
    try {
      const response = await this.fetchImpl(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw fail(`${provider.label} rejected the API credential or account permissions. Check AI Configuration.`, 409);
        if (response.status === 429) throw fail(`${provider.label} is rate limited or has exhausted its quota. Try again later.`, 429);
        if (response.status >= 400 && response.status < 500) throw fail(`${provider.label} rejected the model or search tool configuration (HTTP ${response.status}). Check the configured search model and account tool access.`, 409);
        throw fail(`${provider.label} could not complete the search (HTTP ${response.status}). Check the configured model and web search access.`, 502);
      }
      data = await response.json();
    } catch (error) {
      if (error.statusCode) throw error;
      throw fail(error.name === "TimeoutError" || error.name === "AbortError" ? `${provider.label} search timed out. Try again.` : `${provider.label} could not be reached. Try again later.`, 502);
    }
    const sources = [];
    const addSource = (url, title) => {
      const safe = safeUrl(url);
      if (safe && !sources.some((item) => item.url === safe)) sources.push({ url: safe, title: String(title || safe) });
    };
    let answer = "", webSearchUsed = false;
    if (provider.id === "openai") {
      const parts = (data.output || []).flatMap((item) => item.content || []);
      answer = parts.filter((part) => part.type === "output_text").map((part) => part.text || "").join("\n");
      for (const part of parts) for (const citation of part.annotations || []) if (citation.type === "url_citation") addSource(citation.url, citation.title);
      webSearchUsed = (data.output || []).some((item) => item.type === "web_search_call" && item.status === "completed");
    } else if (provider.id === "google") {
      const candidate = data.candidates?.[0];
      answer = (candidate?.content?.parts || []).filter((part) => !part.thought).map((part) => part.text || "").join("\n");
      for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) addSource(chunk.web?.uri, chunk.web?.title);
      webSearchUsed = Boolean(candidate?.groundingMetadata?.webSearchQueries?.length);
    } else {
      answer = (data.content || []).filter((part) => part.type === "text").map((part) => part.text || "").join("\n");
      for (const part of data.content || []) {
        for (const citation of part.citations || []) addSource(citation.url, citation.title);
        if (part.type === "web_search_tool_result") {
          if (part.content?.type === "web_search_tool_result_error") throw fail(`${provider.label} web search failed. Check web search access or try again.`, 502);
          if (Array.isArray(part.content)) { webSearchUsed = true; for (const result of part.content) addSource(result.url, result.title); }
        }
      }
    }
    if (requireWebSearch && !webSearchUsed) throw fail(`${provider.label} returned no verifiable web search evidence. No prospects were imported.`, 409);
    return { provider: provider.id, providerLabel: provider.label, model, answer, sources,
      webSearchUsed: webEnabled && webSearchUsed,
      notice: webEnabled && webSearchUsed ? "AI-generated answer using web search. Review the cited sources." : "AI-generated answer; live web search was not used. Verify factual claims." };
  }
}
