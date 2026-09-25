"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type AcquisitionView = "Overview" | "Acquisition Configurations" | "Prospects" | "Conversations" | "Search Sources" | "Communication Settings" | "Analytics";
type AIProvider = { id: number; providerName: string; providerCode: string; enabled: boolean };
type SearchSource = { sourceCode: string; enabled: boolean; priority: number; settings: Record<string, unknown> };
type CommunicationMethod = {
  channel: string; enabled: boolean; priority: number; maximumAttempts: number;
  retryDelayMinutes: number; delayBeforeNextChannelMinutes: number; stopOnResponse: boolean; allowSimultaneous: boolean;
};
type AcquisitionConfiguration = {
  id: number; acquisitionName: string; objective: string; companyProfileId: number; productOrService: string;
  targetIndustry: string; targetCustomerType: string; targetLocation: string; keywords: string; businessSize: string;
  startDate: string | null; endDate: string | null; dailyProspectLimit: number; automaticOutreachEnabled: boolean; aiProviderId: number;
  fallbackAIProviderId: number | null; minimumProspectFitScore: number; qualificationQuestions: string[];
  landingPageOrCTA: string; humanHandoffRules: Record<string, unknown>; followUpRules: Record<string, unknown>;
  conversionCriteria: { requireEngagement: boolean; allowLandingRegistration: boolean; minimumFitScore: number };
  status: string; providerName?: string | null; searchSources: SearchSource[]; communicationMethods: CommunicationMethod[];
};
type Prospect = {
  id: number; acquisitionConfigurationId: number; companyName: string; contactName: string; industry: string;
  location: string; website: string; email: string; phone: string; whatsAppNumber: string; instagram: string;
  facebook: string; source: string; fitScore: number; fitReason: string; status: string; responded: boolean;
  convertedLeadId: string | null; discoveredAt: string;
};
type Conversation = {
  id: number; prospectId: number; companyName: string; contactName: string; channel: string; direction: string;
  message: string; origin: string; deliveryStatus: string; occurredAt: string;
};
type ManualTask = { id: number; acquisitionConfigurationId: number; prospectId: number; companyName: string;
  contactValue: string; message: string; createdAt: string; status: string };
type Overview = Record<string, number>;
type Analytics = { overview: Overview; sources: Record<string, unknown>[]; channels: Record<string, unknown>[]; configurations: Record<string, unknown>[] };

const SOURCE_NAMES: Record<string, string> = {
  GOOGLE_PLACES: "Google Places / business search",
  APOLLO_IO: "Apollo.io decision-maker discovery",
  EXISTING_CRM: "Existing Next2TheTop CRM data",
  INACTIVE_LEADS: "Existing cold/inactive Leads",
  LANDING_PAGE: "Landing Page registrations/activity",
  INSTAGRAM_INBOUND: "Instagram inbound activity",
  FACEBOOK_INBOUND: "Facebook inbound activity",
  WEBSITE_FORMS: "Website forms",
  CSV_IMPORT: "CSV prospect import",
  BUSINESS_DIRECTORY: "Approved business directories",
  PARTNER_API: "Partner/API data sources",
};
const CHANNEL_NAMES: Record<string, string> = {
  EMAIL: "Email", WHATSAPP_BUSINESS: "WhatsApp Business", INSTAGRAM: "Instagram", FACEBOOK: "Facebook",
  SMS: "SMS", MANUAL_HUMAN_FOLLOW_UP: "Manual human follow-up",
};
const SOURCE_CODES = Object.keys(SOURCE_NAMES);
const CHANNEL_CODES = Object.keys(CHANNEL_NAMES);
const APOLLO_DEFAULT_SETTINGS: Record<string, unknown> = {
  peopleSearchEnabled: true,
  companySearchEnabled: false,
  standardPeopleEnrichmentEnabled: false,
  waterfallEmailEnabled: false,
  phoneEnrichmentEnabled: false,
  waterfallPhoneEnabled: false,
  minimumFitScoreForStandardEnrichment: 60,
  minimumFitScoreForWaterfallEmail: 80,
  minimumFitScoreForPhone: 80,
  dailyCreditLimit: 0,
  monthlyCreditLimit: 0,
  resultLimit: 25,
  preferKnownDomains: true,
  decisionMakerTitles: ["Owner", "Founder", "Co-Founder", "CEO", "President", "Managing Director", "Marketing Director", "Marketing Manager", "Business Development Director"],
  seniorities: ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager"],
};

function defaultSources(): SearchSource[] {
  return SOURCE_CODES.map((sourceCode, index) => ({
    sourceCode, enabled: ["EXISTING_CRM", "INACTIVE_LEADS"].includes(sourceCode), priority: index + 1,
    settings: sourceCode === "APOLLO_IO" ? { ...APOLLO_DEFAULT_SETTINGS } : {},
  }));
}

function withAvailableSources(configuration: AcquisitionConfiguration): AcquisitionConfiguration {
  const existing = new Set(configuration.searchSources.map((source) => source.sourceCode));
  const nextPriority = Math.max(0, ...configuration.searchSources.map((source) => Number(source.priority) || 0));
  const missing = defaultSources().filter((source) => !existing.has(source.sourceCode))
    .map((source, index) => ({ ...source, priority: nextPriority + index + 1 }));
  const searchSources = [...configuration.searchSources, ...missing].map((source) => source.sourceCode === "APOLLO_IO"
    ? { ...source, settings: { ...APOLLO_DEFAULT_SETTINGS, ...source.settings } } : source);
  return { ...configuration, searchSources };
}

function defaultMethods(): CommunicationMethod[] {
  return CHANNEL_CODES.map((channel, index) => ({
    channel, enabled: ["EMAIL", "MANUAL_HUMAN_FOLLOW_UP"].includes(channel), priority: index + 1,
    maximumAttempts: channel === "MANUAL_HUMAN_FOLLOW_UP" ? 1 : 3, retryDelayMinutes: 1440,
    delayBeforeNextChannelMinutes: 1440, stopOnResponse: true, allowSimultaneous: false,
  }));
}

function emptyConfiguration(providerId = 0): Omit<AcquisitionConfiguration, "id"> & { id?: number } {
  return {
    acquisitionName: "", objective: "", companyProfileId: 1, productOrService: "", targetIndustry: "",
    targetCustomerType: "", targetLocation: "", keywords: "", businessSize: "", startDate: null, endDate: null,
    dailyProspectLimit: 50, automaticOutreachEnabled: false, aiProviderId: providerId, fallbackAIProviderId: null, minimumProspectFitScore: 50,
    qualificationQuestions: ["ContactName", "BusinessGoal", "Timeline"], landingPageOrCTA: "",
    humanHandoffRules: { minimumLeadScore: 80, minimumAIConfidence: 0.65, onHumanRequest: true },
    followUpRules: { enabled: true, maximumFollowUps: 3, delayBetweenAttemptsMinutes: 1440, channelEscalationEnabled: true, stopOnResponse: true, stopOnOptOut: true, stopOnDoNotContact: true },
    conversionCriteria: { requireEngagement: true, allowLandingRegistration: true, minimumFitScore: 0 },
    status: "DRAFT", searchSources: defaultSources(), communicationMethods: defaultMethods(),
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/acquisition/${path}`, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string; message?: string; diagnosticCode?: string };
  if (!response.ok) {
    const detail = body.diagnosticCode ? ` (diagnostic ${body.diagnosticCode})` : "";
    throw new Error(`${body.error || body.message || "AI Acquisition request failed."}${detail}`);
  }
  return body;
}

async function aiProviderOptions(): Promise<AIProvider[]> {
  const response = await fetch("/api/ai/providers", { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { providers?: AIProvider[]; error?: string; message?: string };
  if (!response.ok) throw new Error(body.error || body.message || `AI provider request failed (${response.status}).`);
  if (!Array.isArray(body.providers)) throw new Error("AI provider response did not include a provider list.");
  return body.providers.filter((provider) => provider.enabled);
}

async function loadPart<T>(label: string, request: Promise<T>, apply: (value: T) => void): Promise<string | null> {
  try {
    apply(await request);
    return null;
  } catch (error) {
    return `${label}: ${error instanceof Error ? error.message : "Could not load."}`;
  }
}

function numberMetric(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusClass(status: string) {
  if (["ACTIVE", "QUALIFIED", "CONVERTED_TO_LEAD"].includes(status)) return "registered";
  if (["ENGAGED", "CONTACTABLE", "CONTACTING"].includes(status)) return "engaged";
  if (["HUMAN_HANDOFF", "HOT", "FAILED"].includes(status)) return "hot";
  return "new";
}

function parseProspectCsv(content: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      record.push(field.trim()); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      record.push(field.trim()); field = "";
      if (record.some(Boolean)) records.push(record);
      record = [];
    } else field += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  record.push(field.trim());
  if (record.some(Boolean)) records.push(record);
  const [headers, ...data] = records;
  const names: Record<string, string> = {
    companyname: "companyName", businessname: "companyName", contactname: "contactName",
    industry: "industry", location: "location", website: "website", email: "email",
    businessemail: "email", phone: "phone", businessphone: "phone", whatsappnumber: "whatsAppNumber",
    instagram: "instagram", facebook: "facebook", x: "x", externalsourceid: "externalSourceId",
    sourceurl: "sourceUrl", consentstatus: "consentStatus", optedout: "optedOut",
  };
  const columns = (headers || []).map((header) => names[header.replace(/^\uFEFF/, "").replace(/[^a-z0-9]/gi, "").toLowerCase()] || "");
  if (!columns.includes("companyName")) throw new Error("CSV requires a companyName or businessName column.");
  if (data.length > 1000) throw new Error("Import at most 1,000 prospect rows at a time.");
  return data.map((values) => Object.fromEntries(columns.map((name, index) => [name, values[index] || ""]).filter(([name]) => name)))
    .filter((row) => row.companyName);
}

export function AIAcquisition({ view }: { view: AcquisitionView }) {
  const [configurations, setConfigurations] = useState<AcquisitionConfiguration[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [manualTasks, setManualTasks] = useState<ManualTask[]>([]);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [overview, setOverview] = useState<Overview>({});
  const [analytics, setAnalytics] = useState<Analytics>({ overview: {}, sources: [], channels: [], configurations: [] });
  const [selectedConfigurationId, setSelectedConfigurationId] = useState<number | null>(null);
  const [editing, setEditing] = useState<ReturnType<typeof emptyConfiguration> | AcquisitionConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => configurations.find((item) => item.id === selectedConfigurationId) || configurations[0] || null,
    [configurations, selectedConfigurationId]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const failures = await Promise.all([
        loadPart("Configurations", api<{ configurations: AcquisitionConfiguration[] }>("configurations"), (data) => {
          setConfigurations((data.configurations || []).map(withAvailableSources));
          setSelectedConfigurationId((current) => current || data.configurations?.[0]?.id || null);
        }),
        loadPart("Prospects", api<{ prospects: Prospect[] }>("prospects?limit=500"), (data) => setProspects(data.prospects || [])),
        loadPart("Conversations", api<{ conversations: Conversation[] }>("conversations?limit=500"), (data) => setConversations(data.conversations || [])),
        loadPart("Manual tasks", api<{ tasks: ManualTask[] }>("manual-tasks"), (data) => setManualTasks(data.tasks || [])),
        loadPart("Overview", api<{ overview: Overview }>("overview"), (data) => setOverview(data.overview || {})),
        loadPart("Analytics", api<{ analytics: Analytics }>("analytics"), (data) => setAnalytics(data.analytics || { overview: {}, sources: [], channels: [], configurations: [] })),
        loadPart("AI providers", aiProviderOptions(), setProviders),
      ]);
      setError(failures.filter((failure): failure is string => Boolean(failure)).join(" "));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "AI Acquisition could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const mutate = async (path: string, payload: Record<string, unknown>, successMessage: string) => {
    setBusy(true); setError("");
    try {
      await api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setMessage(successMessage); setTimeout(() => setMessage(""), 2800); await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "The operation failed.");
    } finally { setBusy(false); }
  };

  const saveConfiguration = async () => {
    if (!editing) return;
    setBusy(true); setError("");
    try {
      await api("configurations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(editing),
      });
      setEditing(null); setMessage("Acquisition configuration saved."); await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The configuration could not be saved.");
    } finally { setBusy(false); }
  };

  const configurationPicker = configurations.length > 0 && (
    <label className="acquisition-picker">Configuration
      <select value={selected?.id || ""} onChange={(event) => setSelectedConfigurationId(Number(event.target.value))}>
        {configurations.map((configuration) => <option key={configuration.id} value={configuration.id}>{configuration.acquisitionName}</option>)}
      </select>
    </label>
  );

  return <div className="acquisition-module">
    <div className="module-head">
      <div><span className="insight-tag">INDEPENDENT MODULE</span><h2>AI Acquisition · {view}</h2><p>Discover, qualify, and convert prospects without changing Campaigns or the existing Lead lifecycle.</p></div>
      <div className="acquisition-head-actions">{configurationPicker}<span className="system-badge">MSSQL source of truth</span></div>
    </div>
    {error && <p className="acquisition-alert error" role="alert">{error}</p>}
    {message && <p className="acquisition-alert success" role="status">{message}</p>}
    {busy && <div className="acquisition-loading">Updating acquisition data…</div>}

    {view === "Overview" && <OverviewView overview={overview} configurations={configurations} selected={selected} busy={busy}
      manualTasks={manualTasks.filter((task) => !selected || task.acquisitionConfigurationId === selected.id)}
      onAction={(action) => selected && mutate("configurations/action", { id: selected.id, action }, `${action.toLowerCase()} completed.`)}
      onDiscover={() => selected && mutate("discover", { configurationId: selected.id }, "Discovery run completed.")}
      onCompleteTask={(id) => mutate(`manual-tasks/${id}/complete`, {}, "Manual review marked complete.")} />}

    {view === "Acquisition Configurations" && <ConfigurationView configurations={configurations} editing={editing}
      setEditing={setEditing} providers={providers} busy={busy} save={saveConfiguration} />}

    {view === "Prospects" && <ProspectsView prospects={prospects.filter((item) => !selected || item.acquisitionConfigurationId === selected.id)}
      busy={busy} onContact={(id) => mutate("prospects/contact", { prospectId: id }, "Highest-priority allowed contact queued.")}
      onConvert={(id) => mutate("prospects/convert", { prospectId: id }, "Prospect matched or created in the existing Lead system.")}
      onDiscover={() => selected && mutate("discover", { configurationId: selected.id }, "Discovery run completed.")}
      onImport={async (file) => {
        if (!selected) throw new Error("Create an acquisition configuration before importing prospects.");
        if (file.size > 1_000_000) throw new Error("The CSV must be 1 MB or smaller.");
        const rows = parseProspectCsv(await file.text());
        if (!rows.length) throw new Error("The CSV has no prospect rows.");
        await mutate("prospects/import", { configurationId: selected.id, rows }, "CSV prospect import completed.");
      }} />}

    {view === "Conversations" && <ConversationsView conversations={conversations.filter((item) => !selected || prospects.find((prospect) => prospect.id === item.prospectId)?.acquisitionConfigurationId === selected.id)} />}

    {view === "Search Sources" && <><SettingsView title="Search source priority" description="Only enabled sources run. Provider results normalize into the common Prospect model."
      rows={(selected?.searchSources || []).map((row) => ({ ...row, code: row.sourceCode, name: SOURCE_NAMES[row.sourceCode] || humanize(row.sourceCode) }))}
      empty="Create an Acquisition Configuration to set search sources." />
      <ApolloProviderPanel configuration={selected} busy={busy} onEnrich={() => selected && mutate("providers/apollo/enrich", { configurationId: selected.id }, "Apollo enrichment cycle completed.")} /></>}

    {view === "Communication Settings" && <SettingsView title="Communication priority and policy" description="Disabled or unavailable channels are filtered before the highest-priority allowed method is selected."
      rows={(selected?.communicationMethods || []).map((row) => ({ ...row, code: row.channel, name: CHANNEL_NAMES[row.channel] || humanize(row.channel) }))}
      empty="Create an Acquisition Configuration to set communication methods." communication />}

    {view === "Analytics" && <AnalyticsView analytics={analytics} />}
  </div>;
}

function OverviewView({ overview, configurations, selected, manualTasks, busy, onAction, onDiscover, onCompleteTask }: {
  overview: Overview; configurations: AcquisitionConfiguration[]; selected: AcquisitionConfiguration | null; busy: boolean;
  manualTasks: ManualTask[]; onAction: (action: string) => void; onDiscover: () => void; onCompleteTask: (id: number) => void;
}) {
  const metrics = [
    ["Active configurations", overview.activeConfigurations], ["Prospects discovered", overview.prospectsDiscovered],
    ["Contactable prospects", overview.contactableProspects], ["Contacts attempted", overview.contactsAttempted],
    ["Prospects contacted", overview.prospectsContacted], ["Conversations started", overview.conversationsStarted],
    ["Reply rate %", overview.replyRatePercent], ["Lead conversion rate %", overview.leadConversionRatePercent],
    ["Leads created/matched", overview.leadsCreated], ["Qualified leads", overview.qualifiedLeads],
    ["Hot leads", overview.hotLeads], ["Average Lead Score", overview.averageLeadScore],
    ["Human handoffs", overview.humanHandoffs], ["Conversions", overview.conversions],
  ];
  return <>
    <div className="acquisition-metric-grid">{metrics.map(([label, value], index) => <article key={String(label)}><span>{index + 1}</span><p>{label}</p><h3>{numberMetric(value)}</h3></article>)}</div>
    <section className="panel acquisition-control-panel">
      <div className="panel-head"><div><h3>Acquisition controls</h3><p>Lifecycle controls apply only to the selected acquisition configuration.</p></div>{selected && <span className={`status ${statusClass(selected.status)}`}>{humanize(selected.status)}</span>}</div>
      {selected ? <><h4>{selected.acquisitionName}</h4><p>{selected.objective}</p><div className="card-actions">
        {selected.status === "DRAFT" && <button disabled={busy} onClick={() => onAction("START")}>Start</button>}
        {selected.status === "ACTIVE" && <button disabled={busy} onClick={() => onAction("PAUSE")}>Pause</button>}
        {selected.status === "PAUSED" && <button disabled={busy} onClick={() => onAction("RESUME")}>Resume</button>}
        {!['STOPPED', 'COMPLETED'].includes(selected.status) && <button disabled={busy} onClick={() => onAction("STOP")}>Stop</button>}
        <button disabled={busy || !["ACTIVE", "DRAFT", "PAUSED"].includes(selected.status)} onClick={onDiscover}>Run discovery</button>
      </div></> : <p className="acquisition-empty-copy">{configurations.length ? "Select a configuration." : "Create your first acquisition configuration."}</p>}
    </section>
    <section className="panel acquisition-settings"><div className="panel-head"><div><h3>Manual review queue</h3><p>Human handoffs stay separate from the outbound delivery worker.</p></div><span className="system-badge">{manualTasks.length} pending</span></div>
      {manualTasks.map((task) => <article key={task.id}><b>!</b><div><strong>{task.companyName || `Prospect ${task.prospectId}`}</strong><small>{task.message} · {task.contactValue}</small></div><button disabled={busy} onClick={() => onCompleteTask(task.id)}>Mark reviewed</button></article>)}
      {!manualTasks.length && <p className="acquisition-empty-copy">No manual reviews are pending.</p>}
    </section>
  </>;
}

function ConfigurationView({ configurations, editing, setEditing, providers, busy, save }: {
  configurations: AcquisitionConfiguration[]; editing: ReturnType<typeof emptyConfiguration> | AcquisitionConfiguration | null;
  setEditing: (value: ReturnType<typeof emptyConfiguration> | AcquisitionConfiguration | null) => void; providers: AIProvider[]; busy: boolean; save: () => void;
}) {
  const update = (field: string, value: unknown) => setEditing(editing ? { ...editing, [field]: value } : editing);
  const updateSourceSettings = (index: number, settings: Record<string, unknown>) => {
    if (!editing) return;
    update("searchSources", editing.searchSources.map((item, itemIndex) => itemIndex === index ? { ...item, settings } : item));
  };
  return <div className="acquisition-config-layout">
    <section className="panel acquisition-list">
      <div className="panel-head"><div><h3>Configurations</h3><p>Multiple independent acquisition strategies can run side by side.</p></div><button className="primary" onClick={() => setEditing(emptyConfiguration(providers[0]?.id || 0))}>New Acquisition</button></div>
      {configurations.map((configuration) => <button key={configuration.id} onClick={() => setEditing(structuredClone(withAvailableSources(configuration)))}>
        <span><strong>{configuration.acquisitionName}</strong><small>{configuration.productOrService} · {configuration.targetLocation || "Any location"}</small></span>
        <i className={`status ${statusClass(configuration.status)}`}>{humanize(configuration.status)}</i>
      </button>)}
      {!configurations.length && <p className="acquisition-empty-copy">No acquisition configurations yet.</p>}
    </section>
    <section className="panel">
      {!editing ? <div className="empty"><span>✦</span><h3>Select or create a configuration</h3><p>Configuration keeps discovery, communication, qualification, and handoff policy together.</p></div> : <div className="acquisition-form">
        <div className="panel-head"><div><h3>{editing.id ? "Edit acquisition" : "New acquisition"}</h3><p>Company Profile and AI provider credentials are reused; no duplicate settings are created.</p></div><button className="ghost" onClick={() => setEditing(null)}>Close</button></div>
        <div className="acquisition-form-grid">
          <label>Acquisition name<input value={editing.acquisitionName} onChange={(event) => update("acquisitionName", event.target.value)} /></label>
          <label>Product or service<input value={editing.productOrService} onChange={(event) => update("productOrService", event.target.value)} /></label>
          <label className="wide">Objective<textarea value={editing.objective} onChange={(event) => update("objective", event.target.value)} /></label>
          <label>Target industry<input value={editing.targetIndustry} onChange={(event) => update("targetIndustry", event.target.value)} /></label>
          <label>Target customer type<input value={editing.targetCustomerType} onChange={(event) => update("targetCustomerType", event.target.value)} /></label>
          <label>Target location<input value={editing.targetLocation} onChange={(event) => update("targetLocation", event.target.value)} /></label>
          <label>Business size<input value={editing.businessSize} onChange={(event) => update("businessSize", event.target.value)} /></label>
          <label className="wide">Keywords<input value={editing.keywords} onChange={(event) => update("keywords", event.target.value)} /></label>
          <label>Start date<input type="date" value={editing.startDate || ""} onChange={(event) => update("startDate", event.target.value || null)} /></label>
          <label>End date<input type="date" value={editing.endDate || ""} onChange={(event) => update("endDate", event.target.value || null)} /></label>
          <label>Daily prospect limit<input type="number" min="1" max="10000" value={editing.dailyProspectLimit} onChange={(event) => update("dailyProspectLimit", Number(event.target.value))} /></label>
          <label className="acquisition-checkbox"><input type="checkbox" checked={editing.automaticOutreachEnabled} onChange={(event) => update("automaticOutreachEnabled", event.target.checked)} /> Automatically queue policy-allowed outreach</label>
          <label>Minimum fit score<input type="number" min="0" max="100" value={editing.minimumProspectFitScore} onChange={(event) => update("minimumProspectFitScore", Number(event.target.value))} /></label>
          <label>AI provider<select value={editing.aiProviderId || ""} onChange={(event) => update("aiProviderId", Number(event.target.value))}><option value="">Select provider</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.providerName}</option>)}</select></label>
          <label>Fallback provider<select value={editing.fallbackAIProviderId || ""} onChange={(event) => update("fallbackAIProviderId", event.target.value ? Number(event.target.value) : null)}><option value="">No fallback</option>{providers.filter((provider) => provider.id !== editing.aiProviderId).map((provider) => <option key={provider.id} value={provider.id}>{provider.providerName}</option>)}</select></label>
          <label className="wide">Qualification fields / questions<textarea value={editing.qualificationQuestions.join("\n")} onChange={(event) => update("qualificationQuestions", event.target.value.split("\n").filter(Boolean))} /></label>
          <label className="wide">Landing page or CTA<input value={editing.landingPageOrCTA} onChange={(event) => update("landingPageOrCTA", event.target.value)} /></label>
          <label>Conversion minimum fit score<input type="number" min="0" max="100" value={editing.conversionCriteria?.minimumFitScore ?? 0} onChange={(event) => update("conversionCriteria", { ...editing.conversionCriteria, minimumFitScore: Number(event.target.value) })} /></label>
          <label>Conversion criteria<select value={editing.conversionCriteria?.requireEngagement === false ? "MANUAL" : "ENGAGED"} onChange={(event) => update("conversionCriteria", { ...editing.conversionCriteria, requireEngagement: event.target.value === "ENGAGED" })}><option value="ENGAGED">Engaged or registered</option><option value="MANUAL">Manual conversion after fit threshold</option></select></label>
        </div>
        <details className="acquisition-inline-settings"><summary>Search sources ({editing.searchSources.filter((source) => source.enabled).length} enabled)</summary>
          {editing.searchSources.map((source, index) => <div className="acquisition-source-setting" key={source.sourceCode}><label><input type="checkbox" checked={source.enabled} onChange={(event) => update("searchSources", editing.searchSources.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} /><span>{SOURCE_NAMES[source.sourceCode]}</span><input aria-label={`${source.sourceCode} priority`} type="number" min="1" max="100" value={source.priority} onChange={(event) => update("searchSources", editing.searchSources.map((item, itemIndex) => itemIndex === index ? { ...item, priority: Number(event.target.value) } : item))} /></label>{source.sourceCode === "APOLLO_IO" ? <ApolloSettingsEditor settings={source.settings} onChange={(settings) => updateSourceSettings(index, settings)} /> : <textarea aria-label={`${source.sourceCode} provider settings JSON`} defaultValue={JSON.stringify(source.settings, null, 2)} onBlur={(event) => {
            try {
              const settings = JSON.parse(event.currentTarget.value || "{}");
              event.currentTarget.setCustomValidity("");
              update("searchSources", editing.searchSources.map((item, itemIndex) => itemIndex === index ? { ...item, settings } : item));
            } catch { event.currentTarget.setCustomValidity("Enter valid JSON provider settings."); event.currentTarget.reportValidity(); }
          }} />}</div>)}</details>
        <details className="acquisition-inline-settings"><summary>Communication methods ({editing.communicationMethods.filter((method) => method.enabled).length} enabled)</summary>
          {editing.communicationMethods.map((method, index) => <div className="acquisition-method-setting" key={method.channel}><label><input type="checkbox" checked={method.enabled} onChange={(event) => update("communicationMethods", editing.communicationMethods.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} /><span>{CHANNEL_NAMES[method.channel]}</span><input aria-label={`${method.channel} priority`} title="Priority" type="number" min="1" max="100" value={method.priority} onChange={(event) => update("communicationMethods", editing.communicationMethods.map((item, itemIndex) => itemIndex === index ? { ...item, priority: Number(event.target.value) } : item))} /></label><div><label>Max attempts<input type="number" min="1" max="20" value={method.maximumAttempts} onChange={(event) => update("communicationMethods", editing.communicationMethods.map((item, itemIndex) => itemIndex === index ? { ...item, maximumAttempts: Number(event.target.value) } : item))} /></label><label>Retry delay (min)<input type="number" min="1" value={method.retryDelayMinutes} onChange={(event) => update("communicationMethods", editing.communicationMethods.map((item, itemIndex) => itemIndex === index ? { ...item, retryDelayMinutes: Number(event.target.value) } : item))} /></label><label>Next channel delay (min)<input type="number" min="0" value={method.delayBeforeNextChannelMinutes} onChange={(event) => update("communicationMethods", editing.communicationMethods.map((item, itemIndex) => itemIndex === index ? { ...item, delayBeforeNextChannelMinutes: Number(event.target.value) } : item))} /></label><label className="acquisition-checkbox"><input type="checkbox" checked={method.stopOnResponse} onChange={(event) => update("communicationMethods", editing.communicationMethods.map((item, itemIndex) => itemIndex === index ? { ...item, stopOnResponse: event.target.checked } : item))} /> Stop on response</label></div></div>)}</details>
        <details className="acquisition-inline-settings"><summary>Handoff and follow-up rules</summary>
          <div className="acquisition-form-grid">
            <label>Minimum AI confidence<input type="number" min="0" max="1" step="0.05" value={Number(editing.humanHandoffRules.minimumAIConfidence ?? 0.65)} onChange={(event) => update("humanHandoffRules", { ...editing.humanHandoffRules, minimumAIConfidence: Number(event.target.value) })} /></label>
            <label>Lead score handoff threshold<input type="number" min="0" max="100" value={Number(editing.humanHandoffRules.minimumLeadScore ?? 80)} onChange={(event) => update("humanHandoffRules", { ...editing.humanHandoffRules, minimumLeadScore: Number(event.target.value) })} /></label>
            <label>Maximum follow-ups<input type="number" min="0" max="20" value={Number(editing.followUpRules.maximumFollowUps ?? 3)} onChange={(event) => update("followUpRules", { ...editing.followUpRules, maximumFollowUps: Number(event.target.value) })} /></label>
            <label>Delay between attempts (min)<input type="number" min="1" value={Number(editing.followUpRules.delayBetweenAttemptsMinutes ?? 1440)} onChange={(event) => update("followUpRules", { ...editing.followUpRules, delayBetweenAttemptsMinutes: Number(event.target.value) })} /></label>
            <label className="acquisition-checkbox"><input type="checkbox" checked={editing.followUpRules.enabled !== false} onChange={(event) => update("followUpRules", { ...editing.followUpRules, enabled: event.target.checked })} /> Enable follow-up policy</label>
          </div>
          <p>Automatic follow-up scheduling and score-triggered CRM notifications require a connected worker.</p>
        </details>
        <div className="acquisition-form-actions"><button className="ghost" onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Configuration"}</button></div>
      </div>}
    </section>
  </div>;
}

function ApolloSettingsEditor({ settings, onChange }: { settings: Record<string, unknown>; onChange: (settings: Record<string, unknown>) => void }) {
  const set = (name: string, value: unknown) => onChange({ ...settings, [name]: value });
  const list = (name: string) => Array.isArray(settings[name]) ? (settings[name] as unknown[]).map(String).join("\n") : String(settings[name] || "");
  const setList = (name: string, value: string) => set(name, value.split("\n").map((item) => item.trim()).filter(Boolean));
  const toggle = (name: string, label: string) => <label className="acquisition-checkbox"><input type="checkbox" checked={settings[name] === true} onChange={(event) => set(name, event.target.checked)} /> {label}</label>;
  const number = (name: string, label: string, maximum = 100) => <label>{label}<input type="number" min="0" max={maximum} value={Number(settings[name] || 0)} onChange={(event) => set(name, Number(event.target.value))} /></label>;
  return <div className="apollo-settings-grid">
    <p className="wide"><strong>Credential reference:</strong> server-side <code>APOLLO_API_KEY</code>. The key is never returned to this screen.</p>
    {toggle("peopleSearchEnabled", "People Search")}
    {toggle("companySearchEnabled", "Company Search (optional)")}
    {toggle("standardPeopleEnrichmentEnabled", "Standard People Enrichment")}
    {toggle("waterfallEmailEnabled", "Selective Waterfall Email")}
    {toggle("phoneEnrichmentEnabled", "Selective Phone Enrichment")}
    {toggle("waterfallPhoneEnabled", "Selective Waterfall Phone")}
    {toggle("preferKnownDomains", "Prefer domains from existing directory prospects")}
    {toggle("acceptMediumConfidence", "Accept medium-confidence matches")}
    {number("minimumFitScoreForStandardEnrichment", "Minimum fit for standard enrichment")}
    {number("minimumFitScoreForWaterfallEmail", "Minimum fit for waterfall email")}
    {number("minimumFitScoreForPhone", "Minimum fit for phone")}
    {number("dailyCreditLimit", "Daily credit limit", 1_000_000)}
    {number("monthlyCreditLimit", "Monthly credit limit", 10_000_000)}
    {number("resultLimit", "People Search result limit", 100)}
    <label className="wide">Decision-maker titles<textarea value={list("decisionMakerTitles")} onChange={(event) => setList("decisionMakerTitles", event.target.value)} /></label>
    <label className="wide">Seniorities<textarea value={list("seniorities")} onChange={(event) => setList("seniorities", event.target.value)} /></label>
    <label>Organization domains<textarea value={list("organizationDomains")} placeholder="example.com" onChange={(event) => setList("organizationDomains", event.target.value)} /></label>
    <label>Organization locations<textarea value={list("organizationLocations")} placeholder="Miami, Florida" onChange={(event) => setList("organizationLocations", event.target.value)} /></label>
    <label>Person locations<textarea value={list("personLocations")} placeholder="Florida" onChange={(event) => setList("personLocations", event.target.value)} /></label>
    <label>Employee ranges<textarea value={list("employeeRanges")} placeholder="1,10" onChange={(event) => setList("employeeRanges", event.target.value)} /></label>
    <label>Organization IDs<textarea value={list("organizationIds")} onChange={(event) => setList("organizationIds", event.target.value)} /></label>
    <label>Technology UIDs<textarea value={list("technologyUids")} placeholder="salesforce" onChange={(event) => setList("technologyUids", event.target.value)} /></label>
    <label className="wide">Excluded domains<textarea value={list("excludedDomains")} onChange={(event) => setList("excludedDomains", event.target.value)} /></label>
    <p className="wide">A limit of 0 keeps all paid enrichment off. Apollo phone results are stored as Phone only and never become WhatsApp consent.</p>
  </div>;
}

type ApolloStatus = { configured?: boolean; enabled?: boolean; connected?: boolean; account?: string; polling?: boolean; standardEnrichmentEnabled?: boolean };
type ApolloUsage = { limits?: { dailyCreditLimit?: number; monthlyCreditLimit?: number }; summary?: Record<string, number>;
  requests?: Array<{ id: number; requestKind: string; status: string; requestedCount: number; successCount: number; creditsConsumed: number; errorMessage: string; createdAt: string }> };

function ApolloProviderPanel({ configuration, busy, onEnrich }: { configuration: AcquisitionConfiguration | null; busy: boolean; onEnrich: () => void }) {
  const [status, setStatus] = useState<ApolloStatus>({});
  const [usage, setUsage] = useState<ApolloUsage>({});
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!configuration) return;
    try {
      const [statusBody, usageBody] = await Promise.all([
        api<{ status: ApolloStatus }>(`providers/apollo/status?configurationId=${configuration.id}`),
        api<{ usage: ApolloUsage }>(`providers/apollo/usage?configurationId=${configuration.id}`),
      ]);
      setStatus(statusBody.status || {}); setUsage(usageBody.usage || {}); setDetail("");
    } catch (error) { setDetail(error instanceof Error ? error.message : "Apollo status could not be loaded."); }
  }, [configuration]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  if (!configuration) return <section className="panel"><p className="acquisition-empty-copy">Select an acquisition configuration to view Apollo status and usage.</p></section>;
  const test = async () => {
    setLoading(true); setDetail("");
    try {
      const body = await api<{ status: ApolloStatus }>("providers/apollo/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ configurationId: configuration.id }) });
      setStatus(body.status || {}); setDetail("Apollo connection succeeded.");
    } catch (error) { setDetail(error instanceof Error ? error.message : "Apollo connection failed."); }
    finally { setLoading(false); }
  };
  const summary = usage.summary || {};
  return <section className="panel acquisition-apollo-panel">
    <div className="panel-head"><div><h3>Apollo provider</h3><p>People Search → Prospect Fit Score → standard enrichment → selective waterfall/phone. Polling handles async results.</p></div><span className={`status ${status.configured ? "registered" : "hot"}`}>{status.configured ? "Credential configured" : "Credential missing"}</span></div>
    <div className="acquisition-metric-grid">
      <article><p>Daily credits</p><h3>{numberMetric(summary.dailyCreditsConsumed)} / {numberMetric(usage.limits?.dailyCreditLimit)}</h3></article>
      <article><p>Monthly credits</p><h3>{numberMetric(summary.monthlyCreditsConsumed)} / {numberMetric(usage.limits?.monthlyCreditLimit)}</h3></article>
      <article><p>Enrichment requests</p><h3>{numberMetric(summary.requestedCount)}</h3></article>
      <article><p>Successful records</p><h3>{numberMetric(summary.successCount)}</h3></article>
      <article><p>Failures / rate limits</p><h3>{numberMetric(Number(summary.failedRequests || 0) + Number(summary.rateLimitedRequests || 0))}</h3></article>
    </div>
    <div className="card-actions"><button disabled={busy || loading} onClick={test}>Test Connection</button><button disabled={busy || loading || !status.configured} onClick={onEnrich}>Run Eligible Enrichment</button><button disabled={loading} onClick={() => void load()}>Refresh Usage</button></div>
    {detail && <p className={`acquisition-alert ${detail.includes("succeeded") ? "success" : "error"}`}>{detail}</p>}
    <details><summary>Recent Apollo requests and errors</summary>{(usage.requests || []).slice(0, 20).map((request) => <p key={request.id}><strong>{humanize(request.requestKind)}</strong> · {humanize(request.status)} · {request.successCount}/{request.requestedCount} records · {request.creditsConsumed} credits{request.errorMessage ? ` · ${request.errorMessage}` : ""}</p>)}</details>
  </section>;
}

function ProspectsView({ prospects, busy, onContact, onConvert, onDiscover, onImport }: { prospects: Prospect[]; busy: boolean; onContact: (id: number) => void; onConvert: (id: number) => void; onDiscover: () => void; onImport: (file: File) => Promise<void> }) {
  const [importError, setImportError] = useState("");
  return <section className="panel data-panel acquisition-data-panel"><div className="acquisition-table-title"><div><h3>Prospect workspace</h3><p>Prospects remain separate from Leads until conversion criteria are met.</p></div><div className="acquisition-head-actions"><label className="acquisition-picker">Import CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setImportError("");
    try { await onImport(file); } catch (error) { setImportError(error instanceof Error ? error.message : "CSV import failed."); }
    event.currentTarget.value = "";
  }} /></label><button className="primary" disabled={busy} onClick={onDiscover}>Run discovery</button></div></div>
    {importError && <p className="acquisition-alert error" role="alert">{importError}</p>}
    <div className="acquisition-table acquisition-prospect-cols table-head"><span>Prospect</span><span>Source</span><span>Fit</span><span>Status</span><span>Contact</span><span>Actions</span></div>
    {prospects.map((prospect) => <div className="acquisition-table acquisition-prospect-cols" key={prospect.id}>
      <span className="contact"><i>{prospect.companyName.slice(0, 2).toUpperCase()}</i><b>{prospect.companyName}<small>{prospect.contactName || prospect.location || "No contact name"}</small></b></span>
      <span>{humanize(prospect.source)}</span><strong>{prospect.fitScore}/100</strong><span className={`status ${statusClass(prospect.status)}`}>{humanize(prospect.status)}</span>
      <span className="acquisition-contact-stack"><small>{prospect.email || prospect.phone || prospect.instagram || prospect.website || "Not contactable"}</small></span>
      <span className="acquisition-row-actions"><button disabled={busy || prospect.status === "DO_NOT_CONTACT" || Boolean(prospect.convertedLeadId)} onClick={() => onContact(prospect.id)}>Queue contact</button><button disabled={busy || Boolean(prospect.convertedLeadId)} onClick={() => onConvert(prospect.id)}>{prospect.convertedLeadId ? "Converted" : "Convert to Lead"}</button></span>
    </div>)}
    {!prospects.length && <div className="empty"><span>⌕</span><h3>No prospects discovered</h3><p>Run an enabled source or import prospect rows after creating a configuration.</p></div>}
  </section>;
}

function ConversationsView({ conversations }: { conversations: Conversation[] }) {
  return <section className="panel acquisition-conversations"><div className="panel-head"><div><h3>Prospect conversation history</h3><p>AI proposals, delivery state, inbound replies, and human handoffs remain auditable before and after Lead conversion.</p></div></div>
    {conversations.map((conversation) => <article key={conversation.id} className={conversation.direction.toLowerCase()}><span>{conversation.direction === "INBOUND" ? "↙" : "↗"}</span><div><div><strong>{conversation.companyName || `Prospect ${conversation.prospectId}`}</strong><small>{humanize(conversation.channel)} · {conversation.origin} · {humanize(conversation.deliveryStatus)}</small></div><p>{conversation.message}</p></div><time>{new Date(conversation.occurredAt).toLocaleString()}</time></article>)}
    {!conversations.length && <div className="empty"><span>◌</span><h3>No acquisition conversations yet</h3><p>Inbound messages and policy-validated AI response proposals will appear here.</p></div>}
  </section>;
}

function SettingsView({ title, description, rows, empty, communication = false }: {
  title: string; description: string; rows: Array<Record<string, unknown> & { code: string; name: string; enabled: boolean; priority: number }>; empty: string; communication?: boolean;
}) {
  return <section className="panel acquisition-settings"><div className="panel-head"><div><h3>{title}</h3><p>{description}</p></div></div>
    {rows.sort((left, right) => left.priority - right.priority).map((row) => <article key={row.code}><b>{row.priority}</b><div><strong>{row.name}</strong><small>{row.code}{communication ? ` · max ${String(row.maximumAttempts)} attempts · ${String(row.delayBeforeNextChannelMinutes)} min escalation delay` : ""}</small></div><span className={`status ${row.enabled ? "registered" : "new"}`}>{row.enabled ? "Enabled" : "Disabled"}</span></article>)}
    {!rows.length && <p className="acquisition-empty-copy">{empty}</p>}
  </section>;
}

function AnalyticsView({ analytics }: { analytics: Analytics }) {
  const table = (title: string, rows: Record<string, unknown>[]) => <section className="panel acquisition-analytics-table"><div className="panel-head"><div><h3>{title}</h3><p>Persisted authoritative acquisition data</p></div></div>{rows.map((row, index) => <article key={index}>{Object.entries(row).map(([key, value]) => <span key={key}><small>{humanize(key)}</small><strong>{typeof value === "number" ? value.toLocaleString() : String(value ?? "—")}</strong></span>)}</article>)}{!rows.length && <p className="acquisition-empty-copy">No data yet.</p>}</section>;
  return <div className="acquisition-analytics-grid">{table("Performance by Search Source", analytics.sources)}{table("Performance by Communication Channel", analytics.channels)}{table("Performance by Acquisition Configuration", analytics.configurations)}</div>;
}
