"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

type BufferChannel = {
  id: string;
  displayName: string;
  service: string;
  isQueuePaused: boolean;
};

type AIProviderConfiguration = {
  id: number;
  providerCode: string;
  providerName: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  capabilities: string[];
  hasSecret: boolean;
  maskedSecret: string;
  connectionStatus: string;
  lastTestedAt: string | null;
  lastError: string | null;
  updatedAt?: string | null;
};

type CompanyProfile = {
  companyName: string;
  companyDescription: string;
  productsServices: string;
  targetAudience: string;
  brandVoice: string;
  offers: string;
  website: string;
  preferredCTA: string;
  industry: string;
  businessGoals: string;
  otherProfileContext: string;
  updatedAt?: string | null;
};

type AICampaignConfiguration = {
  id: number;
  campaignName: string;
  campaignObjective: string;
  startDate: string;
  endDate: string;
  postsPerDay: number;
  contentTypes: string[];
  aiProviderId: number;
  aiModel: string | null;
  fallbackProviderId: number | null;
  selectedBufferChannelIds: string[];
  cta: string;
  destinationUrl: string;
  publishingMode: "DRAFT" | "PRODUCTION";
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "STOPPED" | "FAILED";
  providerName: string | null;
  fallbackProviderName: string | null;
  successfulGenerationCount: number;
  lastGenerationAt: string | null;
  lastError: string | null;
};

type AIGenerationHistory = {
  id: number;
  configurationId: number;
  generationDate: string;
  runSlot: number;
  bufferChannelId: string;
  generationStatus: string;
  providerCode: string | null;
  model: string | null;
  campaignId: number | string | null;
  campaignPostId: number | null;
  regenerated: boolean;
  fallbackUsed: boolean;
  attemptCount: number;
  normalizedOutput: {
    headline?: string;
    caption?: string;
    cta_text?: string;
    image_prompt?: string;
    video_prompt?: string;
  } | null;
  error: string | null;
  postStatus: string | null;
  bufferPostId: string | null;
  scheduledAt: string | null;
};

const contentTypes = [
  "EDUCATIONAL", "PROMOTIONAL", "TESTIMONIAL", "FAQ", "BENEFITS", "PROBLEM_SOLUTION",
  "SOCIAL_PROOF", "TIPS", "STORY", "URGENCY", "DIRECT_CTA",
];

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(body.error || body.message || "The request could not be completed.");
  return body;
}

function CompanyProfileSettings() {
  const [profile, setProfile] = useState<CompanyProfile | null | undefined>(undefined);
  const [message, setMessage] = useState("Loading Company Profile…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void jsonRequest<{ profile: CompanyProfile | null }>("/api/company-profile", { cache: "no-store" })
      .then((body) => {
        setProfile(body.profile);
        setMessage(body.profile ? "Saved profile is the primary context for every AI campaign." : "Complete this once before starting an AI campaign.");
      })
      .catch((error) => {
        setProfile(null);
        setMessage(error instanceof Error ? error.message : "Company Profile could not be loaded.");
      });
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const body = await jsonRequest<{ profile: CompanyProfile }>("/api/company-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      setProfile(body.profile);
      setMessage("Company Profile saved. New generations will use this context.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Company Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (profile === undefined) return <article className="panel"><h3>Company Profile</h3><p>{message}</p></article>;
  return (
    <article className="panel ai-settings-panel">
      <div className="panel-head"><div><h3>Company Profile</h3><p>{message}</p></div></div>
      <form key={profile?.updatedAt || "new-profile"} onSubmit={save} className="ai-settings-form">
        <label>Company name<input name="companyName" required defaultValue={profile?.companyName || ""} /></label>
        <label>Industry<input name="industry" defaultValue={profile?.industry || ""} /></label>
        <label className="wide">Company description<textarea name="companyDescription" required defaultValue={profile?.companyDescription || ""} /></label>
        <label className="wide">Products and services<textarea name="productsServices" defaultValue={profile?.productsServices || ""} /></label>
        <label className="wide">Target audience<textarea name="targetAudience" defaultValue={profile?.targetAudience || ""} /></label>
        <label>Brand voice<input name="brandVoice" placeholder="Clear, warm, confident" defaultValue={profile?.brandVoice || ""} /></label>
        <label>Preferred CTA<input name="preferredCTA" defaultValue={profile?.preferredCTA || ""} /></label>
        <label>Website<input name="website" type="url" defaultValue={profile?.website || ""} /></label>
        <label className="wide">Offers<textarea name="offers" defaultValue={profile?.offers || ""} /></label>
        <label className="wide">Business goals<textarea name="businessGoals" defaultValue={profile?.businessGoals || ""} /></label>
        <label className="wide">Other profile context<textarea name="otherProfileContext" defaultValue={profile?.otherProfileContext || ""} /></label>
        <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save Company Profile"}</button>
      </form>
    </article>
  );
}

function ProviderCard({ provider, onChanged }: { provider: AIProviderConfiguration; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(provider.lastError || "");

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      await jsonRequest("/api/ai/providers", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: provider.id,
          providerName: form.get("providerName"),
          model: form.get("model"),
          apiKey: form.get("apiKey"),
          enabled: form.get("enabled") === "true",
          isDefault: form.get("isDefault") === "true",
        }),
      });
      setMessage("Configuration saved. The API key remains encrypted on the server.");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Provider configuration could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await jsonRequest("/api/ai/providers/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: provider.id }),
      });
      setMessage("Connection successful.");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection test failed.");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="ai-provider-card">
      <div><strong>{provider.providerName}</strong><span className={`integration-state ${provider.connectionStatus === "CONNECTED" ? "connected" : ""}`}>{provider.connectionStatus.replaceAll("_", " ")}</span></div>
      <label>Provider name<input name="providerName" required defaultValue={provider.providerName} /></label>
      <label>Model<input name="model" required defaultValue={provider.model} /></label>
      <label>API key<input name="apiKey" type="password" autoComplete="new-password" placeholder={provider.hasSecret ? provider.maskedSecret : "Paste server-side key"} /></label>
      <div className="ai-provider-options">
        <label><input type="checkbox" name="enabled" value="true" defaultChecked={provider.enabled} /> Enabled</label>
        <label><input type="checkbox" name="isDefault" value="true" defaultChecked={provider.isDefault} /> Default</label>
      </div>
      <small>{provider.capabilities.join(" · ")}</small>
      {message && <small className={provider.lastError ? "form-error" : "config-state"}>{message}</small>}
      <div className="card-actions"><button className="primary" disabled={busy}>Save provider</button><button type="button" disabled={busy || !provider.hasSecret} onClick={() => void test()}>Test connection</button></div>
    </form>
  );
}

function AIProviderSettings() {
  const [providers, setProviders] = useState<AIProviderConfiguration[]>([]);
  const [message, setMessage] = useState("Loading AI providers…");
  const load = useCallback(async () => {
    try {
      const body = await jsonRequest<{ providers: AIProviderConfiguration[] }>("/api/ai/providers", { cache: "no-store" });
      setProviders(body.providers);
      setMessage("Configure OpenAI, Claude, and Gemini independently. Exactly one saved provider remains the default.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI providers could not be loaded.");
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return (
    <article className="panel ai-settings-panel">
      <div className="panel-head"><div><h3>AI Provider Configuration</h3><p>{message}</p></div></div>
      <div className="ai-provider-grid">
        {providers.map((provider) => <ProviderCard key={`${provider.id}-${provider.updatedAt || provider.connectionStatus}`} provider={provider} onChanged={load} />)}
      </div>
      <small className="config-state">Keys are AES-256-GCM encrypted in MSSQL and are never returned to the browser.</small>
    </article>
  );
}

export function AISettingsPanels() {
  return <><CompanyProfileSettings /><AIProviderSettings /></>;
}

function RegenerateControl({ run, providers, onRegenerated }: {
  run: AIGenerationHistory;
  providers: AIProviderConfiguration[];
  onRegenerated: () => Promise<void>;
}) {
  const [providerId, setProviderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const eligible = run.postStatus === "DRAFT" || (run.postStatus === "FAILED" && !run.bufferPostId);
  const regenerate = async () => {
    setBusy(true);
    try {
      await jsonRequest("/api/ai/campaigns/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id, providerId: providerId || null }),
      });
      await onRegenerated();
      setMessage("Draft regenerated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Draft regeneration failed.");
    } finally {
      setBusy(false);
    }
  };
  if (!eligible || run.generationStatus !== "SUCCEEDED") return null;
  return (
    <div className="ai-regenerate-control">
      <select aria-label="Optional regeneration provider" value={providerId} onChange={(event) => setProviderId(event.target.value)}>
        <option value="">Configured provider</option>
        {providers.filter((provider) => provider.enabled).map((provider) => <option key={provider.id} value={provider.id}>{provider.providerName}</option>)}
      </select>
      <button type="button" disabled={busy} onClick={() => void regenerate()}>{busy ? "Regenerating…" : "Regenerate draft"}</button>
      {message && <small className={message === "Draft regenerated." ? "config-state" : "form-error"}>{message}</small>}
    </div>
  );
}

function AICampaignForm({ configuration, providers, channels, busy, onSubmit, onCancel }: {
  configuration: AICampaignConfiguration | null;
  providers: AIProviderConfiguration[];
  channels: BufferChannel[];
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCancel: () => void;
}) {
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const defaultProvider = configuration?.aiProviderId || enabledProviders.find((provider) => provider.isDefault)?.id || enabledProviders[0]?.id;
  const socialChannels = channels.filter((channel) => ["facebook", "instagram"].includes(channel.service));
  const start = configuration?.startDate || localDate();
  const defaultEnd = new Date();
  defaultEnd.setDate(defaultEnd.getDate() + 30);
  return (
    <form className="ai-campaign-form" onSubmit={(event) => void onSubmit(event)}>
      <input type="hidden" name="id" value={configuration?.id || ""} readOnly />
      <div className="form-grid">
        <label>Campaign name<input name="campaignName" required defaultValue={configuration?.campaignName || ""} /></label>
        <label>AI provider<select name="aiProviderId" required defaultValue={String(defaultProvider || "")}><option value="">Select provider</option>{enabledProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.providerName}{provider.isDefault ? " · default" : ""}</option>)}</select></label>
        <label>Start date<input name="startDate" type="date" required defaultValue={start} /></label>
        <label>End date<input name="endDate" type="date" required defaultValue={configuration?.endDate || localDate(defaultEnd)} /></label>
        <label>Posts per day<input name="postsPerDay" type="number" min="1" max="10" required defaultValue={configuration?.postsPerDay || 1} /></label>
        <label>Model override<input name="aiModel" placeholder="Use provider model" defaultValue={configuration?.aiModel || ""} /></label>
        <label>Explicit fallback<select name="fallbackProviderId" defaultValue={String(configuration?.fallbackProviderId || "")}><option value="">No fallback</option>{enabledProviders.filter((provider) => provider.id !== defaultProvider).map((provider) => <option key={provider.id} value={provider.id}>{provider.providerName}</option>)}</select></label>
        <label>Publishing mode<select name="publishingMode" defaultValue={configuration?.publishingMode || "DRAFT"}><option value="DRAFT">Save generated posts as drafts</option><option value="PRODUCTION">Schedule through Buffer</option></select></label>
      </div>
      <label>Campaign objective<textarea name="campaignObjective" required defaultValue={configuration?.campaignObjective || ""} /></label>
      <div className="form-grid">
        <label>CTA<input name="cta" defaultValue={configuration?.cta || ""} /></label>
        <label>Destination / landing page URL<input name="destinationUrl" type="url" defaultValue={configuration?.destinationUrl || ""} /></label>
      </div>
      <fieldset className="buffer-channel-picker"><legend>Connected Facebook / Instagram accounts</legend>{socialChannels.map((channel, index) => <div className="checkbox-field" key={channel.id}><input id={`ai-buffer-${index}`} type="checkbox" name="selectedBufferChannelIds" value={channel.id} disabled={channel.isQueuePaused} defaultChecked={configuration?.selectedBufferChannelIds.includes(channel.id)} /><label htmlFor={`ai-buffer-${index}`}><strong>{channel.displayName}</strong><small>{channel.service}{channel.isQueuePaused ? " · queue paused" : ""}</small></label></div>)}</fieldset>
      <fieldset className="ai-content-types"><legend>Content variety</legend>{contentTypes.map((type) => <label key={type}><input type="checkbox" name="contentTypes" value={type} defaultChecked={configuration ? configuration.contentTypes.includes(type) : ["EDUCATIONAL", "PROMOTIONAL", "TIPS"].includes(type)} /> {type.replaceAll("_", " ")}</label>)}</fieldset>
      <div className="card-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className="primary" name="intent" value="save" disabled={busy || !enabledProviders.length || !socialChannels.length}>{busy ? "Working…" : "Save AI campaign"}</button>
        <button className="primary ai-start" name="intent" value="start" disabled={busy || !enabledProviders.length || !socialChannels.length}>START AI CAMPAIGN NOW</button>
      </div>
    </form>
  );
}

export function AICampaignManager({ bufferChannels, onCampaignsChanged }: {
  bufferChannels: BufferChannel[];
  onCampaignsChanged: () => Promise<void>;
}) {
  const [providers, setProviders] = useState<AIProviderConfiguration[]>([]);
  const [configurations, setConfigurations] = useState<AICampaignConfiguration[]>([]);
  const [history, setHistory] = useState<AIGenerationHistory[]>([]);
  const [editing, setEditing] = useState<AICampaignConfiguration | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading AI campaign automation…");

  const load = useCallback(async () => {
    try {
      const [providerBody, campaignBody] = await Promise.all([
        jsonRequest<{ providers: AIProviderConfiguration[] }>("/api/ai/providers", { cache: "no-store" }),
        jsonRequest<{ configurations: AICampaignConfiguration[]; history: AIGenerationHistory[] }>("/api/ai/campaigns", { cache: "no-store" }),
      ]);
      setProviders(providerBody.providers);
      setConfigurations(campaignBody.configurations);
      setHistory(campaignBody.history);
      setMessage("Daily generation is idempotent per campaign date, slot, and selected Buffer account.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI campaign automation could not be loaded.");
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      const saved = await jsonRequest<{ configuration: AICampaignConfiguration }>("/api/ai/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: form.get("id") || null,
          campaignName: form.get("campaignName"),
          campaignObjective: form.get("campaignObjective"),
          startDate: form.get("startDate"),
          endDate: form.get("endDate"),
          postsPerDay: form.get("postsPerDay"),
          contentTypes: form.getAll("contentTypes"),
          aiProviderId: form.get("aiProviderId"),
          aiModel: form.get("aiModel"),
          fallbackProviderId: form.get("fallbackProviderId") || null,
          selectedBufferChannelIds: form.getAll("selectedBufferChannelIds"),
          cta: form.get("cta"),
          destinationUrl: form.get("destinationUrl"),
          publishingMode: form.get("publishingMode"),
        }),
      });
      if (submitter?.value === "start") {
        const started = await jsonRequest<{ generated: Array<{ status: string }> }>("/api/ai/campaigns/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: saved.configuration.id }),
        });
        const failed = started.generated.filter((item) => item.status === "FAILED").length;
        setMessage(failed ? `Campaign activated, but ${failed} initial generation(s) failed. Review history.` : "AI campaign activated and today's content was generated through the normal Campaign flow.");
        await onCampaignsChanged();
      } else {
        setMessage("AI campaign configuration saved as a draft.");
      }
      setEditing(undefined);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI campaign could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const action = async (configuration: AICampaignConfiguration, operation: "pause" | "resume" | "stop" | "generate_now") => {
    setBusy(true);
    try {
      await jsonRequest("/api/ai/campaigns/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: configuration.id, action: operation }),
      });
      if (operation === "generate_now") await onCampaignsChanged();
      setMessage(operation === "generate_now" ? "Today's idempotent generation check completed." : `AI campaign ${operation.replace("resume", "resumed").replace("pause", "paused").replace("stop", "stopped")}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI campaign action failed.");
    } finally {
      setBusy(false);
    }
  };

  const refreshedAfterRegeneration = async () => {
    await Promise.all([load(), onCampaignsChanged()]);
    setMessage("Draft content regenerated in its existing Campaign and CampaignPost history recorded.");
  };

  return (
    <section className="panel ai-campaign-manager">
      <div className="panel-head"><div><span className="insight-tag">MULTI-PROVIDER · BUFFER NATIVE</span><h3>AI Campaign Automation</h3><p>{message}</p></div><button className="primary" type="button" onClick={() => setEditing(null)}>New AI campaign</button></div>
      {editing !== undefined && <AICampaignForm key={editing?.id || "new-ai-campaign"} configuration={editing} providers={providers} channels={bufferChannels} busy={busy} onSubmit={submit} onCancel={() => setEditing(undefined)} />}
      <div className="ai-automation-grid">
        {configurations.map((configuration) => {
          const runs = history.filter((run) => run.configurationId === configuration.id);
          return <article className="ai-automation-card" key={configuration.id}>
            <div><strong>{configuration.campaignName}</strong><span className={`status ${configuration.status.toLowerCase()}`}>{configuration.status}</span></div>
            <p>{configuration.campaignObjective}</p>
            <small>{configuration.startDate} → {configuration.endDate} · {configuration.postsPerDay}/day/account · {configuration.publishingMode}</small>
            <small>{configuration.providerName || "Provider unavailable"}{configuration.aiModel ? ` · ${configuration.aiModel}` : ""}{configuration.fallbackProviderName ? ` · fallback ${configuration.fallbackProviderName}` : " · no fallback"}</small>
            <small>Buffer accounts: {configuration.selectedBufferChannelIds.map((id) => bufferChannels.find((channel) => channel.id === id)?.displayName || id).join(", ")} · {configuration.successfulGenerationCount} successful generation(s)</small>
            {configuration.lastError && <small className="form-error">{configuration.lastError}</small>}
            <div className="card-actions">
              <button type="button" disabled={busy} onClick={() => setEditing(configuration)}>Edit configuration / provider</button>
              {configuration.status === "ACTIVE" && <button type="button" disabled={busy} onClick={() => void action(configuration, "pause")}>Pause Campaign</button>}
              {["PAUSED", "FAILED"].includes(configuration.status) && <button type="button" disabled={busy} onClick={() => void action(configuration, "resume")}>Resume Campaign</button>}
              {configuration.status === "ACTIVE" && <button type="button" disabled={busy} onClick={() => void action(configuration, "generate_now")}>Generate Today&apos;s Post Now</button>}
              {!(["STOPPED", "COMPLETED"].includes(configuration.status)) && <button type="button" disabled={busy} onClick={() => void action(configuration, "stop")}>Stop Campaign</button>}
            </div>
            <details className="ai-history"><summary>View Generated Posts ({runs.length})</summary>{runs.length ? runs.map((run) => <div className="ai-history-row" key={run.id}><div><strong>{run.normalizedOutput?.headline || `Generation ${run.id}`}</strong><span>{run.generationStatus}{run.regenerated ? " · REGENERATED" : ""}</span></div><small>{run.generationDate} · slot {run.runSlot} · {run.providerCode || "provider pending"} / {run.model || "model pending"}{run.fallbackUsed ? " · fallback used" : ""}</small><small>CampaignPost {run.campaignPostId || "pending"} · {run.postStatus || "not persisted"} · attempts {run.attemptCount}</small>{run.normalizedOutput?.caption && <p>{run.normalizedOutput.caption}</p>}{run.normalizedOutput?.image_prompt && <small>Image prompt: {run.normalizedOutput.image_prompt}</small>}{run.normalizedOutput?.video_prompt && <small>Video prompt: {run.normalizedOutput.video_prompt}</small>}{run.error && <small className="form-error">{run.error}</small>}<RegenerateControl run={run} providers={providers} onRegenerated={refreshedAfterRegeneration} /></div>) : <small>No generation runs yet.</small>}</details>
          </article>;
        })}
      </div>
      {!configurations.length && editing === undefined && <small>No AI campaign configurations yet. Configure the Company Profile and an enabled provider, then create one here.</small>}
    </section>
  );
}
