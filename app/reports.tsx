"use client";

import { useEffect, useMemo, useState } from "react";

type ReportValue = string | number | null | undefined;
type ReportRow = Record<string, ReportValue>;
type ReportFilters = {
  search: string;
  scoreBand: string;
  minScore: string;
  maxScore: string;
  intent: string;
  platform: string;
  source: string;
  campaignId: string;
  startDate: string;
  endDate: string;
};
type Column = {
  key: string;
  label: string;
  format?: "date" | "number" | "temperature" | "handles";
  sortAsc?: string;
  sortDesc?: string;
};
type ReportDefinition = {
  id: string;
  label: string;
  description: string;
  path: string;
  defaultSort: string;
  columns: Column[];
};
type ReportResponse = {
  ok?: boolean;
  error?: string;
  rows?: ReportRow[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

const EMPTY_FILTERS: ReportFilters = {
  search: "",
  scoreBand: "",
  minScore: "",
  maxScore: "",
  intent: "",
  platform: "",
  source: "",
  campaignId: "",
  startDate: "",
  endDate: "",
};

const REPORTS: ReportDefinition[] = [
  {
    id: "lead-scoring",
    label: "Lead Scoring",
    description: "Prioritized leads using the CRM's authoritative score, intent, and temperature.",
    path: "leads/scoring",
    defaultSort: "score_desc",
    columns: [
      { key: "leadName", label: "Lead name", sortAsc: "name_asc", sortDesc: "name_desc" },
      { key: "instagramUsername", label: "Instagram username" },
      { key: "facebookUsername", label: "Facebook username" },
      { key: "xUsername", label: "X / Twitter username" },
      { key: "otherSocialUsernames", label: "Other social username(s)" },
      { key: "leadScore", label: "Score", format: "number", sortAsc: "score_asc", sortDesc: "score_desc" },
      { key: "intent", label: "Intent", sortDesc: "intent_asc" },
      { key: "temperature", label: "Temperature", format: "temperature", sortDesc: "temperature_asc" },
      { key: "lastInteraction", label: "Last interaction" },
      { key: "lastInteractionDate", label: "Last interaction date", format: "date", sortAsc: "last_interaction_asc", sortDesc: "last_interaction_desc" },
      { key: "source", label: "Source" },
      { key: "campaign", label: "Campaign" },
    ],
  },
  {
    id: "lead-temperature",
    label: "Temperature Summary",
    description: "Current distribution across the CRM's COLD, WARM, QUALIFIED, and HOT bands.",
    path: "leads/temperature",
    defaultSort: "temperature_asc",
    columns: [
      { key: "temperature", label: "Temperature", format: "temperature" },
      { key: "leadCount", label: "Lead count", format: "number" },
      { key: "percentage", label: "Percentage" },
      { key: "totalLeads", label: "Total leads", format: "number" },
    ],
  },
  {
    id: "lead-intents",
    label: "Lead Intent",
    description: "Intent frequency and quality across the current lead population.",
    path: "leads/intents",
    defaultSort: "lead_count_desc",
    columns: [
      { key: "intent", label: "Intent", sortDesc: "intent_asc" },
      { key: "leadCount", label: "Lead count", format: "number", sortDesc: "lead_count_desc" },
      { key: "averageLeadScore", label: "Average score", sortDesc: "average_score_desc" },
      { key: "hotLeadCount", label: "Hot leads", format: "number" },
      { key: "qualifiedLeadCount", label: "Qualified leads", format: "number" },
      { key: "mostRecentInteractionDate", label: "Most recent interaction", format: "date", sortDesc: "recent_desc" },
    ],
  },
  {
    id: "lead-sources",
    label: "Source Performance",
    description: "Lead quality and score-band mix by acquisition source.",
    path: "leads/sources",
    defaultSort: "lead_count_desc",
    columns: [
      { key: "source", label: "Source / platform", sortDesc: "source_asc" },
      { key: "leadCount", label: "Lead count", format: "number", sortDesc: "lead_count_desc" },
      { key: "averageScore", label: "Average score", sortDesc: "average_score_desc" },
      { key: "hotLeads", label: "Hot", format: "number" },
      { key: "qualifiedLeads", label: "Qualified", format: "number" },
      { key: "warmLeads", label: "Warm", format: "number" },
      { key: "coldLeads", label: "Cold", format: "number" },
    ],
  },
  {
    id: "campaign-lead-performance",
    label: "Campaign Performance",
    description: "Campaign-attributed leads, scores, and inbound interaction volume.",
    path: "campaigns/lead-performance",
    defaultSort: "total_leads_desc",
    columns: [
      { key: "campaign", label: "Campaign", sortDesc: "campaign_asc" },
      { key: "platform", label: "Platform" },
      { key: "totalLeads", label: "Total leads", format: "number", sortDesc: "total_leads_desc" },
      { key: "averageLeadScore", label: "Average score", sortDesc: "average_score_desc" },
      { key: "hotLeads", label: "Hot", format: "number" },
      { key: "qualifiedLeads", label: "Qualified", format: "number" },
      { key: "totalInboundInteractions", label: "Inbound interactions", format: "number", sortDesc: "inbound_desc" },
      { key: "mostRecentLeadActivity", label: "Most recent activity", format: "date", sortDesc: "recent_desc" },
    ],
  },
  {
    id: "lead-engagement",
    label: "Lead Engagement",
    description: "Inbound and outbound interaction activity for each lead.",
    path: "leads/engagement",
    defaultSort: "last_interaction_desc",
    columns: [
      { key: "lead", label: "Lead", sortDesc: "name_asc" },
      { key: "inboundInteractionCount", label: "Inbound", format: "number", sortDesc: "inbound_desc" },
      { key: "outboundInteractionCount", label: "Outbound", format: "number", sortDesc: "outbound_desc" },
      { key: "commentCount", label: "Comments", format: "number" },
      { key: "dmCount", label: "DMs", format: "number" },
      { key: "lastInteraction", label: "Last interaction" },
      { key: "lastInteractionDate", label: "Interaction date", format: "date", sortDesc: "last_interaction_desc" },
      { key: "leadScore", label: "Score", format: "number", sortDesc: "score_desc" },
      { key: "temperature", label: "Temperature", format: "temperature" },
    ],
  },
  {
    id: "hot-leads",
    label: "Hot Leads",
    description: "Priority leads with a score of at least 80 or the current HOT score band.",
    path: "leads/hot",
    defaultSort: "score_desc",
    columns: [
      { key: "leadName", label: "Lead name", sortDesc: "name_asc" },
      { key: "socialHandles", label: "Social usernames", format: "handles" },
      { key: "score", label: "Score", format: "number", sortDesc: "score_desc" },
      { key: "intent", label: "Intent", sortDesc: "intent_asc" },
      { key: "latestMessage", label: "Latest message" },
      { key: "lastInteractionDate", label: "Last interaction date", format: "date", sortDesc: "last_interaction_desc" },
      { key: "campaign", label: "Campaign" },
      { key: "source", label: "Source" },
    ],
  },
];

function reportParams(filters: ReportFilters, page: number, pageSize: number, sort: string) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    if (key === "startDate") params.set(key, `${value}T00:00:00.000Z`);
    else if (key === "endDate") params.set(key, `${value}T23:59:59.999Z`);
    else params.set(key, value);
  }
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("sort", sort);
  return params;
}

function socialHandles(row: ReportRow) {
  return [
    ["Instagram", row.instagramUsername],
    ["Facebook", row.facebookUsername],
    ["X", row.xUsername],
    ["Other", row.otherSocialUsernames],
  ].filter((entry) => entry[1]).map(([platform, username]) => `${platform}: @${String(username).replace(/^@/, "")}`);
}

function formatDate(value: ReportValue) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function cellText(row: ReportRow, column: Column) {
  if (column.format === "handles") return socialHandles(row).join(" · ") || "—";
  if (column.format === "date") return formatDate(row[column.key]);
  if (column.key === "percentage") return `${Number(row[column.key] || 0).toFixed(2)}%`;
  const value = row[column.key];
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export default function Reports() {
  const [activeId, setActiveId] = useState(REPORTS[0].id);
  const [draftFilters, setDraftFilters] = useState<ReportFilters>({ ...EMPTY_FILTERS });
  const [filters, setFilters] = useState<ReportFilters>({ ...EMPTY_FILTERS });
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState(REPORTS[0].defaultSort);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const report = useMemo(() => REPORTS.find((item) => item.id === activeId) || REPORTS[0], [activeId]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const params = reportParams(filters, page, pageSize, sort);
        const response = await fetch(`/api/reports/${report.path}?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({})) as ReportResponse;
        if (!response.ok) throw new Error(data.error || "The report could not be loaded from SQL Server.");
        setRows(data.rows || []);
        setTotal(data.pagination?.total ?? data.rows?.length ?? 0);
        setTotalPages(data.pagination?.totalPages || 1);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setRows([]);
        setTotal(0);
        setTotalPages(1);
        setError(loadError instanceof Error ? loadError.message : "The report could not be loaded from SQL Server.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [filters, page, pageSize, report, sort]);

  const updateDraft = (key: keyof ReportFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const selectReport = (next: ReportDefinition) => {
    setActiveId(next.id);
    setSort(next.defaultSort);
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    setError("");
    try {
      const exported: ReportRow[] = [];
      let exportPage = 1;
      let exportPages = 1;
      do {
        const params = reportParams(filters, exportPage, 500, sort);
        const response = await fetch(`/api/reports/${report.path}?${params}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as ReportResponse;
        if (!response.ok) throw new Error(data.error || "The filtered report could not be exported.");
        exported.push(...(data.rows || []));
        exportPages = data.pagination?.totalPages || 1;
        exportPage += 1;
      } while (exportPage <= exportPages);

      const csv = [
        report.columns.map((column) => csvCell(column.label)).join(","),
        ...exported.map((row) => report.columns.map((column) => csvCell(cellText(row, column))).join(",")),
      ].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${report.id}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "The filtered report could not be exported.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="reports-section">
      <div className="module-head">
        <div>
          <p>LIVE MSSQL REPORTING</p>
          <h2>CRM Reports</h2>
          <span>Operational and executive views built from current CRM records.</span>
        </div>
        <button className="ghost" type="button" onClick={() => void exportCsv()} disabled={loading || exporting}>
          {exporting ? "Preparing CSV…" : "Export filtered CSV"}
        </button>
      </div>

      <div className="report-tabs" role="tablist" aria-label="CRM reports">
        {REPORTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === report.id}
            className={item.id === report.id ? "active" : ""}
            onClick={() => selectReport(item)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <article className="panel report-filter-panel">
        <div className="report-title-row">
          <div>
            <span className="insight-tag">{report.label.toUpperCase()}</span>
            <h3>{report.label} Report</h3>
            <p>{report.description}</p>
          </div>
          <strong>{total.toLocaleString()} {total === 1 ? "row" : "rows"}</strong>
        </div>
        <div className="report-filters">
          <label><span>Search</span><input value={draftFilters.search} onChange={(event) => updateDraft("search", event.target.value)} placeholder="Lead, handle, or campaign" /></label>
          <label><span>Temperature</span><select value={draftFilters.scoreBand} onChange={(event) => updateDraft("scoreBand", event.target.value)}><option value="">All bands</option><option>COLD</option><option>WARM</option><option>QUALIFIED</option><option>HOT</option></select></label>
          <label><span>Minimum score</span><input type="number" min="0" max="100" value={draftFilters.minScore} onChange={(event) => updateDraft("minScore", event.target.value)} /></label>
          <label><span>Maximum score</span><input type="number" min="0" max="100" value={draftFilters.maxScore} onChange={(event) => updateDraft("maxScore", event.target.value)} /></label>
          <label><span>Intent</span><input value={draftFilters.intent} onChange={(event) => updateDraft("intent", event.target.value)} placeholder="e.g. PRICING" /></label>
          <label><span>Platform</span><select value={draftFilters.platform} onChange={(event) => updateDraft("platform", event.target.value)}><option value="">All platforms</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="x">X / Twitter</option></select></label>
          <label><span>Source</span><input value={draftFilters.source} onChange={(event) => updateDraft("source", event.target.value)} placeholder="Source" /></label>
          <label><span>Campaign ID</span><input type="number" min="1" value={draftFilters.campaignId} onChange={(event) => updateDraft("campaignId", event.target.value)} /></label>
          <label><span>From (UTC)</span><input type="date" value={draftFilters.startDate} onChange={(event) => updateDraft("startDate", event.target.value)} /></label>
          <label><span>Through (UTC)</span><input type="date" value={draftFilters.endDate} onChange={(event) => updateDraft("endDate", event.target.value)} /></label>
        </div>
        <div className="report-filter-actions">
          <button className="ghost" type="button" onClick={() => { setDraftFilters({ ...EMPTY_FILTERS }); setFilters({ ...EMPTY_FILTERS }); setPage(1); }}>Reset</button>
          <button className="primary" type="button" onClick={() => { setFilters({ ...draftFilters }); setPage(1); }}>Apply filters</button>
        </div>
      </article>

      {report.id === "lead-temperature" && !loading && !error && (
        <div className="report-summary-grid">
          {rows.map((row) => (
            <article className="panel" key={String(row.temperature)}>
              <span className={`report-temperature ${String(row.temperature).toLowerCase()}`}>{row.temperature}</span>
              <strong>{Number(row.leadCount || 0).toLocaleString()}</strong>
              <small>{Number(row.percentage || 0).toFixed(2)}% of {Number(row.totalLeads || 0).toLocaleString()} leads</small>
            </article>
          ))}
        </div>
      )}

      <article className="panel report-table-panel" aria-live="polite">
        {loading ? (
          <div className="report-state"><span className="report-spinner" />Loading live report data…</div>
        ) : error ? (
          <div className="report-state error" role="alert"><strong>Report unavailable</strong><span>{error}</span></div>
        ) : rows.length === 0 ? (
          <div className="report-state"><strong>No matching records</strong><span>Adjust the filters or date range and try again.</span></div>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr>{report.columns.map((column) => {
                const sortable = column.sortAsc || column.sortDesc;
                const selected = sort === column.sortAsc || sort === column.sortDesc;
                return <th key={column.key} aria-sort={selected ? (sort === column.sortAsc ? "ascending" : "descending") : "none"}>
                  {sortable ? <button type="button" onClick={() => { setSort(sort === column.sortDesc && column.sortAsc ? column.sortAsc : column.sortDesc || column.sortAsc || sort); setPage(1); }}>{column.label}<span>{selected ? (sort === column.sortAsc ? "↑" : "↓") : "↕"}</span></button> : column.label}
                </th>;
              })}</tr></thead>
              <tbody>{rows.map((row, rowIndex) => (
                <tr key={String(row.leadId ?? row.campaignId ?? row.intent ?? row.source ?? row.temperature ?? rowIndex)}>
                  {report.columns.map((column) => (
                    <td key={column.key} className={column.format === "handles" ? "report-handles" : ""}>
                      {column.format === "temperature"
                        ? <span className={`report-temperature ${String(row[column.key] || "").toLowerCase()}`}>{cellText(row, column)}</span>
                        : cellText(row, column)}
                    </td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="report-pagination">
            <span>Page {page.toLocaleString()} of {totalPages.toLocaleString()}</span>
            <label>Rows <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
            <button className="ghost" type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <button className="ghost" type="button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
          </div>
        )}
      </article>
    </section>
  );
}
