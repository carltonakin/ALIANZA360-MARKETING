"use client";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { browserVideoValidationErrors, INSTAGRAM_VIDEO_MAX_BYTES } from "../lib/instagram-video-validation.mjs";
import type { AuthUser } from "./auth/shared";

// Type definitions
type Lead = {
  id: number | string;
  name: string;
  email: string;
  phone: string;
  social: string;
  facebook: string;
  instagram: string;
  x: string;
  source: string;
  status: string;
  value: number;
  createdAt: string;
  leadScore?: number;
  leadTemperature?: string;
  scoreBand?: string;
  intentScore?: number;
  engagementScore?: number;
  fitScore?: number;
  recencyScore?: number;
  sourceScore?: number;
  scoreReason?: string;
  lastScoredAt?: string | null;
  intent?: string;
  crmNotes?: string;
  qualification?: Record<string, unknown>;
  company?: string;
  productServiceInterest?: string;
  assignedSalesperson?: string;
  lastContactAt?: string | null;
  lastInteractionAt?: string | null;
  lastInteractionType?: string | null;
  lastInteractionText?: string;
  lastResponseAt?: string | null;
  lastResponseType?: string | null;
  lastResponseText?: string;
};

type LeadInput = Omit<Lead, "id" | "status" | "createdAt" | "intent" | "crmNotes"> & {
  lastIntent: string;
  crmnotes: string;
};

type Campaign = {
  id: number | string;
  name: string;
  platform: string;
  audience: string;
  message: string;
  budget: number;
  status: string;
  impressions: number;
  clicks: number;
  createdByAi?: boolean;
  sourceType?: "PAID" | "ORGANIC";
  externalCampaignId?: string | null;
  advertisementId?: string | null;
  leadFormId?: string | null;
  contentReference?: string | null;
  automationStatus?: string;
  automationEnabled?: boolean;
  schedule?: string;
  cadenceMinutes?: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastError?: string | null;
  retryCount?: number;
  maxRetries?: number;
  currentMetrics?: Record<string, unknown> | null;
  lastProcessed?: number;
  campaignObjective?: string;
  postText?: string;
  postType?: "POST" | "REEL" | "STORY";
  mediaType?: "image" | "video" | null;
  mediaUrl?: string | null;
  mediaOriginalName?: string | null;
  mediaMimeType?: string | null;
  mediaSizeBytes?: number | null;
  mediaId?: string | null;
  cloudinaryAssetId?: string | null;
  cloudinaryPublicId?: string | null;
  cloudinaryResourceType?: "image" | "video" | null;
  cloudinaryFormat?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  mediaDurationSeconds?: number | null;
  mediaFrameRate?: number | null;
  mediaVideoCodec?: string | null;
  mediaAudioCodec?: string | null;
  mediaAudioSampleRate?: number | null;
  mediaVideoBitrate?: number | null;
  mediaAudioBitrate?: number | null;
  publishDateTime?: string | null;
  highIntentKeywords?: string;
  aiReplyEnabled?: boolean;
  targetSocialChannels?: BufferChannel[];
  campaignPosts?: CampaignPost[];
};

type CampaignPost = {
  id: number;
  campaignId: number | string | null;
  platform: string;
  bufferChannelId: string;
  bufferPostId: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  postStatus: "DRAFT" | "SCHEDULED" | "QUEUED" | "PUBLISHED" | "FAILED";
  externalPostId: string | null;
  postUrl: string | null;
  lastCheckedAt: string | null;
  errorSource: "BUFFER" | null;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  isActive?: boolean;
};

type BufferChannel = {
  id: string;
  name: string;
  displayName: string;
  service: string;
  avatar: string | null;
  isQueuePaused: boolean;
};

type BufferConnection = {
  provider: "buffer";
  configured: boolean;
  status: string;
  reason: string;
  checkedAt?: string | null;
  missing?: string[];
};

type CampaignMediaUpload = {
  mediaId: string;
  assetId: string;
  publicId: string;
  resourceType: "image" | "video";
  format: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  mediaOriginalName: string;
  mediaMimeType: string;
  mediaSizeBytes: number;
  mediaWidth: number | null;
  mediaHeight: number | null;
  mediaDurationSeconds: number | null;
  mediaFrameRate: number | null;
  mediaVideoCodec: string | null;
  mediaAudioCodec: string | null;
  mediaAudioSampleRate: number | null;
  mediaVideoBitrate: number | null;
  mediaAudioBitrate: number | null;
};

type CampaignMediaReference = Omit<CampaignMediaUpload, "mediaId" | "assetId" | "publicId" | "resourceType" | "format" | "mediaOriginalName" | "mediaMimeType" | "mediaSizeBytes"> & {
  mediaId: string | null;
  assetId: string | null;
  publicId: string | null;
  resourceType: "image" | "video" | null;
  format: string | null;
  mediaOriginalName: string | null;
  mediaMimeType: string | null;
  mediaSizeBytes: number | null;
};

type ClientVideoMetadata = {
  width: number;
  height: number;
  durationSeconds: number;
};

type UnifiedLead = {
  lead: Lead;
  socialAccounts: Array<{ id: string; platform: string; platformUserId?: string; username: string; displayName: string; profileUrl?: string | null }>;
  interactions: Array<{
    id: string;
    platform: string;
    externalInteractionId?: string | null;
    interactionType: string;
    direction: "INBOUND" | "OUTBOUND";
    message: string;
    occurredAt: string;
    intent: string;
    intentConfidence?: number | null;
    sentiment: string;
    sourceType: string;
  }>;
  conversations: Array<{ id: string; platform: string; importantMessage: string; lastMessageAt: string; status: string }>;
  leadActivities: Array<{ id: string; type: string; summary: string; occurredAt: string }>;
  opportunities: unknown[];
  quotes: unknown[];
  appointments: unknown[];
  conversionHistory: unknown[];
};

type Landing = {
  id: number | string;
  campaignId: number | string | null;
  title: string;
  slug: string;
  headline: string;
  teaser: string;
  webinarUrl: string;
  paymentUrl: string;
  status: string;
  registrations: number;
  createdByAi?: boolean;
};

type SocialChannelConfig = {
  channel: "instagram" | "facebook" | "x";
  name: string;
  status: string;
  configured: boolean;
  reason: string;
  lastSuccessfulCheck: string | null;
  lastReceivedEvent: string | null;
  lastError: string | null;
  eventsProcessed: number;
  leadsGenerated: number;
  supportedMetrics: string[];
};

type WebinarRecord = {
  id: number | string;
  campaignId: number | string | null;
  landingPageId: number | string | null;
  title: string;
  description: string;
  scheduledAt: string | null;
  webinarUrl: string;
  status: string;
  createdByAi?: boolean;
};

type SocialChannelResult = Partial<SocialChannelConfig> & {
  channel: "instagram" | "facebook" | "x";
  credentialValidation?: "pass" | "fail" | "skipped";
  listenerTest?: "pass" | "fail" | "skipped";
  metricsTest?: "pass" | "fail" | "skipped";
};

type SocialApiResponse = {
  ok?: boolean;
  message?: string;
  channels?: SocialChannelResult[];
};

type SocialIntegration = {
  provider: "sprout";
  name: string;
  configured: boolean;
  status: string;
  reason: string;
  checkedAt: string | null;
  customerId: string | null;
  profileCount: number;
  listeningTopicCount: number;
  publishingReady: boolean;
  publishingMissing: string[];
  capabilities: string[];
};

type IntegrationAction = {
  id: number | string;
  provider: string;
  channel: string | null;
  direction: "INBOUND" | "OUTBOUND";
  eventType: string;
  idempotencyKey: string;
  externalId: string | null;
  externalStatus: string | null;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  processedAt: string | null;
  campaignId: number | string | null;
  lastError: string | null;
  createdAt: string;
};

type SocialBackendConfig = {
  configured: boolean;
  serviceUrl: string;
  tokenStored: boolean;
  source: "dashboard" | "environment" | null;
  updatedAt: string | null;
};

// Navigation configuration
const nav = [
  ["⌂", "Overview"],
  ["⌁", "Funnel"],
  ["◎", "Campaigns"],
  ["♙", "Leads"],
  ["▷", "Webinar"],
  ["▱", "Landing Pages"],
  ["◉", "Social Listener"],
  ["⚙", "Settings"],
];

export default function Home() {
  const router = useRouter();
  const [active, setActive] = useState("Overview");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [modal, setModal] = useState("");
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editingPage, setEditingPage] = useState<Landing | null>(null);
  const [editingWebinar, setEditingWebinar] = useState<WebinarRecord | null>(null);
  const [unifiedLead, setUnifiedLead] = useState<UnifiedLead | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [campaignSaveError, setCampaignSaveError] = useState("");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pages, setPages] = useState<Landing[]>([]);
  const [webinars, setWebinars] = useState<WebinarRecord[]>([]);
  const [socialIntegrations, setSocialIntegrations] = useState<SocialIntegration[]>([]);
  const [integrationActions, setIntegrationActions] = useState<IntegrationAction[]>([]);
  const [dataError, setDataError] = useState("");
  const [connected, setConnected] = useState(false);
  const [bufferChannels, setBufferChannels] = useState<BufferChannel[]>([]);
  const [bufferConnection, setBufferConnection] = useState<BufferConnection>({
    provider: "buffer",
    configured: false,
    status: "missing_configuration",
    reason: "Buffer has not been checked yet.",
    checkedAt: null,
    missing: ["BUFFER_API_KEY", "BUFFER_ORGANIZATION_ID"],
  });
  const [campaignPublishDefault, setCampaignPublishDefault] = useState("");

  const [testMessage, setTestMessage] = useState("Not tested");
  const [testing, setTesting] = useState(false);
  const [channelTestResults, setChannelTestResults] = useState<{
    [key: string]: string;
  }>({});

  const [socialChannels, setSocialChannels] = useState<SocialChannelConfig[]>([
    {
      channel: "instagram",
      name: "Instagram",
      status: "missing_configuration",
      configured: false,
      reason: "Server configuration has not been loaded.",
      lastSuccessfulCheck: null,
      lastReceivedEvent: null,
      lastError: null,
      eventsProcessed: 0,
      leadsGenerated: 0,
      supportedMetrics: ["reach", "profile_views"],
    },
    {
      channel: "facebook",
      name: "Facebook",
      status: "missing_configuration",
      configured: false,
      reason: "Server configuration has not been loaded.",
      lastSuccessfulCheck: null,
      lastReceivedEvent: null,
      lastError: null,
      eventsProcessed: 0,
      leadsGenerated: 0,
      supportedMetrics: ["page_impressions", "page_post_engagements"],
    },
    {
      channel: "x",
      name: "X",
      status: "missing_configuration",
      configured: false,
      reason: "Server configuration has not been loaded.",
      lastSuccessfulCheck: null,
      lastReceivedEvent: null,
      lastError: null,
      eventsProcessed: 0,
      leadsGenerated: 0,
      supportedMetrics: ["account_public_metrics"],
    },
  ]);

  const applySocialResults = (results: SocialChannelResult[]) => {
    setSocialChannels((prev) =>
      prev.map((channel) => {
        const result = results.find((item) => item.channel === channel.channel);
        return result
          ? {
              ...channel,
              ...result,
              name: result.name || channel.name,
              status: result.status || channel.status,
              reason: result.reason || channel.reason,
              configured: result.configured ?? channel.configured,
              eventsProcessed: result.eventsProcessed ?? channel.eventsProcessed,
              leadsGenerated: result.leadsGenerated ?? channel.leadsGenerated,
              supportedMetrics: result.supportedMetrics || channel.supportedMetrics,
            }
          : channel;
      })
    );
  };

  const handleTestChannel = async (channelName: string) => {
    const channel = socialChannels.find((c) => c.name === channelName);
    if (!channel) return;

    setChannelTestResults((prev) => ({
      ...prev,
      [channelName]: "Testing...",
    }));
    try {
      const response = await fetch("/api/social/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels: [channel.channel] }),
      });
      const data = (await response.json()) as SocialApiResponse;
      const result = data.channels?.find((item) => item.channel === channel.channel);
      if (data.channels) applySocialResults(data.channels);
      const ok = Boolean(response.ok && result?.status === "connected");
      const resultMsg = ok ? "✓ Connected" : result?.reason || data.message || "Connection failed";
      setChannelTestResults((prev) => ({
        ...prev,
        [channelName]: resultMsg,
      }));
      setConnected((wasConnected) => wasConnected || ok);
      setTestMessage(resultMsg);
    } catch {
      setChannelTestResults((prev) => ({
        ...prev,
        [channelName]: "Error: unable to reach service",
      }));
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const response = await fetch("/api/social/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels: socialChannels.map((channel) => channel.channel) }),
      });
      const data = (await response.json()) as SocialApiResponse;
      const results = data.channels || [];
      const connectedChannels = results.filter((item) => item.status === "connected");
      const ok = connectedChannels.length > 0;
      const message =
        data.message ||
        (ok
          ? `${connectedChannels.map((item) => item.name).join(", ")} validated successfully.`
          : "No provider identity check succeeded.");
      setConnected(ok);
      setTestMessage(message);
      if (results.length) applySocialResults(results);
      notify(ok ? "Listener connected successfully" : "Connection test failed");
      setTesting(false);
      return ok ? "live" : "failed";
    } catch {
      setTesting(false);
      const message =
        "Test failed: unable to reach the social listener service.";
      setConnected(false);
      setTestMessage(message);
      notify("Connection test failed");
      return "failed";
    }
  };

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2600);
  };

  const load = async () => {
    try {
      const [crmResponse, integrationResponse] = await Promise.all([
        fetch("/api/data", { cache: "no-store" }),
        fetch("/api/social/integrations?limit=50", { cache: "no-store" }),
      ]);
      if (!crmResponse.ok) {
        const errorData = await crmResponse.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(errorData.message || errorData.error || "Production data could not be loaded from SQL Server.");
      }
      const d = (await crmResponse.json()) as {
        leads?: Lead[];
        campaigns?: Campaign[];
        pages?: Landing[];
        webinars?: WebinarRecord[];
      };
      const normalizeLead = (lead: Lead): Lead => ({
        ...lead,
        facebook: lead.facebook || (lead.source?.toLowerCase().includes("facebook") ? lead.social || "" : ""),
        instagram: lead.instagram || (lead.source?.toLowerCase().includes("instagram") ? lead.social || "" : ""),
        x: lead.x || (/^(x|x \/ twitter|twitter)$/i.test(lead.source || "") ? lead.social || "" : ""),
      });
      setLeads((d.leads ?? []).map(normalizeLead));
      setCampaigns(d.campaigns ?? []);
      setPages(d.pages ?? []);
      setWebinars(d.webinars ?? []);
      setDataError("");

      if (integrationResponse.ok) {
        const integrationData = (await integrationResponse.json()) as {
          integrations?: SocialIntegration[];
          actions?: IntegrationAction[];
        };
        setSocialIntegrations(integrationData.integrations ?? []);
        setIntegrationActions(integrationData.actions ?? []);
      } else {
        setSocialIntegrations([]);
        setIntegrationActions([]);
        notify("Integration activity could not be loaded from SQL Server.");
      }
    } catch (error) {
      setLeads([]);
      setCampaigns([]);
      setPages([]);
      setWebinars([]);
      setSocialIntegrations([]);
      setIntegrationActions([]);
      const message = error instanceof Error ? error.message : "Production data could not be loaded from SQL Server.";
      setDataError(message);
      notify(message);
    }
  };

  const loadBufferChannels = async () => {
    try {
      const response = await fetch("/api/buffer/channels", { cache: "no-store" });
      const data = await response.json() as {
        connection?: BufferConnection;
        channels?: BufferChannel[];
        error?: string;
        message?: string;
      };
      setBufferChannels(data.channels || []);
      setBufferConnection(data.connection || {
        provider: "buffer",
        configured: false,
        status: response.ok ? "disconnected" : "error",
        reason: data.error || data.message || "Buffer channels could not be loaded.",
      });
      return response.ok;
    } catch {
      setBufferChannels([]);
      setBufferConnection({
        provider: "buffer",
        configured: false,
        status: "error",
        reason: "The Buffer campaign service could not be reached.",
      });
      return false;
    }
  };

  const loadSocialStatus = async () => {
    try {
      const response = await fetch("/api/social/status", { cache: "no-store" });
      const data = (await response.json()) as SocialApiResponse;
      const results = data.channels || [];
      if (results.length) {
        applySocialResults(results);
        setConnected(results.some((item) => item.status === "connected"));
      } else if (data.message) {
        setTestMessage(data.message);
      }
    } catch {
      setTestMessage("The Social Listener backend service could not be reached.");
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(async () => {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) {
        router.replace("/login");
        return;
      }
      const auth = await response.json() as { user?: AuthUser };
      if (!auth.user) {
        router.replace("/login");
        return;
      }
      setAuthUser(auth.user);
      const query = new URLSearchParams(window.location.search);
      const requestedView = query.get("view");
      const adminView = requestedView === "Settings" || requestedView === "User Management";
      if (requestedView && (!adminView || auth.user.role === "ADMIN")) setActive(requestedView);
      if (query.has("forbidden")) setToast("Administrator access is required for that area.");
      void load();
      void loadSocialStatus();
      void loadBufferChannels();
    }, 0);
    return () => window.clearTimeout(initialLoad);
    // Initial server state is loaded once when the dashboard mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (
    e: FormEvent<HTMLFormElement>,
    action: string,
    id?: number | string,
    createdByAi = false,
  ) => {
    e.preventDefault();
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const kind = action.split(".")[0];
      const entity = kind === "campaign" ? "campaign" : kind === "page" ? "landing_page" : kind === "webinar" ? "webinar" : null;
      const updating = action.endsWith(".update");
      const r = await fetch(entity ? "/api/social/content" : "/api/data", {
        method: entity && updating ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entity
          ? { entity, ...data, ...(updating ? { id } : {}), status: data.status || "draft", createdByAi }
          : { action, ...data }),
      });
      const d = (await r.json()) as { error?: string; message?: string };
      if (!r.ok) throw new Error(d.error ?? d.message ?? "Could not save");
      await load();
      setModal("");
      notify(entity ? `${updating ? "Changes saved" : "Record created"} successfully` : "Saved successfully");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const saveBufferCampaign = async (
    event: FormEvent<HTMLFormElement>,
    campaign: Campaign | null,
    mediaFile: File | null,
    removeMedia: boolean,
  ) => {
    event.preventDefault();
    setCampaignSaveError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const localPublishDate = new Date(String(form.get("publishDateTime") || ""));
    let uploadedMedia: CampaignMediaUpload | null = null;
    let uploadedMediaPersisted = false;
    try {
      if (Number.isNaN(localPublishDate.getTime())) throw new Error("Choose a valid publish date and time.");
      let media: CampaignMediaReference | null = removeMedia ? null : campaign?.mediaUrl ? {
        mediaId: campaign.mediaId || null,
        assetId: campaign.cloudinaryAssetId || null,
        publicId: campaign.cloudinaryPublicId || null,
        resourceType: campaign.cloudinaryResourceType || null,
        format: campaign.cloudinaryFormat || null,
        mediaType: campaign.mediaType || "image",
        mediaUrl: campaign.mediaUrl,
        mediaOriginalName: campaign.mediaOriginalName || null,
        mediaMimeType: campaign.mediaMimeType || null,
        mediaSizeBytes: campaign.mediaSizeBytes || null,
        mediaWidth: campaign.mediaWidth || null,
        mediaHeight: campaign.mediaHeight || null,
        mediaDurationSeconds: campaign.mediaDurationSeconds || null,
        mediaFrameRate: campaign.mediaFrameRate || null,
        mediaVideoCodec: campaign.mediaVideoCodec || null,
        mediaAudioCodec: campaign.mediaAudioCodec || null,
        mediaAudioSampleRate: campaign.mediaAudioSampleRate || null,
        mediaVideoBitrate: campaign.mediaVideoBitrate || null,
        mediaAudioBitrate: campaign.mediaAudioBitrate || null,
      } : null;
      if (mediaFile) {
        const uploadForm = new FormData();
        uploadForm.append("media", mediaFile);
        uploadForm.append("postType", String(form.get("postType") || "POST"));
        const selectedIds = form.getAll("targetSocialChannels").map(String);
        bufferChannels
          .filter((channel) => selectedIds.includes(channel.id))
          .forEach((channel) => uploadForm.append("targetServices", channel.service));
        const uploadResponse = await fetch("/api/media", { method: "POST", body: uploadForm });
        const uploadData = await uploadResponse.json().catch(() => ({})) as { media?: CampaignMediaUpload; error?: string };
        if (!uploadResponse.ok || !uploadData.media) throw new Error(uploadData.error || "The campaign media could not be uploaded.");
        uploadedMedia = uploadData.media;
        media = uploadedMedia;
      }

      const response = await fetch("/api/buffer/campaigns", {
        method: campaign ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(campaign ? { campaignId: campaign.id } : {}),
          campaignName: form.get("campaignName"),
          campaignObjective: form.get("campaignObjective"),
          postText: form.get("postText"),
          postType: form.get("postType"),
          mediaId: media?.mediaId || null,
          cloudinaryAssetId: media?.assetId || null,
          cloudinaryPublicId: media?.publicId || null,
          cloudinaryResourceType: media?.resourceType || null,
          cloudinaryFormat: media?.format || null,
          mediaType: media?.mediaType || null,
          mediaUrl: media?.mediaUrl || null,
          mediaOriginalName: media?.mediaOriginalName || null,
          mediaMimeType: media?.mediaMimeType || null,
          mediaSizeBytes: media?.mediaSizeBytes || null,
          mediaWidth: media?.mediaWidth || null,
          mediaHeight: media?.mediaHeight || null,
          mediaDurationSeconds: media?.mediaDurationSeconds || null,
          mediaFrameRate: media?.mediaFrameRate || null,
          mediaVideoCodec: media?.mediaVideoCodec || null,
          mediaAudioCodec: media?.mediaAudioCodec || null,
          mediaAudioSampleRate: media?.mediaAudioSampleRate || null,
          mediaVideoBitrate: media?.mediaVideoBitrate || null,
          mediaAudioBitrate: media?.mediaAudioBitrate || null,
          targetSocialChannels: form.getAll("targetSocialChannels"),
          publishDateTime: localPublishDate.toISOString(),
          campaignStatus: form.get("campaignStatus"),
          highIntentKeywords: form.get("highIntentKeywords"),
          aiReplyEnabled: form.get("aiReplyEnabled") === "true",
          createdByAi: campaign?.createdByAi || false,
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        message?: string;
        scheduledCount?: number;
        syncedCount?: number;
        failedCount?: number;
        campaign?: Campaign;
      };
      const persistedBufferFailure = Boolean(data.campaign) && Boolean(data.failedCount);
      uploadedMediaPersisted = Boolean(data.campaign);
      if (!response.ok && response.status !== 207 && !persistedBufferFailure) {
        throw new Error(data.error || data.message || "The Buffer campaign could not be scheduled.");
      }
      await load();
      if (response.status === 207 || persistedBufferFailure) {
        const completedCount = campaign ? data.syncedCount : data.scheduledCount;
        setCampaignSaveError(data.failedCount && !completedCount
          ? `Campaign saved to SQL, but all ${data.failedCount} Buffer posts failed. Review the stored channel errors, correct the problem, and retry.`
          : `Campaign saved to SQL and ${completedCount || 0} Buffer posts succeeded, but ${data.failedCount || 0} failed. Review the stored channel errors, correct the problem, and retry.`);
        if (data.campaign) {
          setEditingCampaign(data.campaign);
          setCampaignPublishDefault(datetimeLocalValue(data.campaign.publishDateTime));
        }
        return;
      }
      setCampaignSaveError("");
      setModal("");
      setEditingCampaign(null);
      const completedCount = campaign ? data.syncedCount : data.scheduledCount;
      notify(data.campaign?.status?.toLowerCase() === "draft" && !data.failedCount
        ? "Campaign draft saved to SQL. No Buffer post was created."
        : data.failedCount && !completedCount
        ? `The campaign was saved, but all ${data.failedCount} Buffer posts failed. Review the stored errors.`
        : data.failedCount
        ? `${completedCount || 0} Buffer posts synchronized; ${data.failedCount} failed and were saved for review.`
        : campaign
        ? `${completedCount || 0} Buffer posts synchronized without creating duplicates.`
        : `${completedCount || 0} Buffer posts scheduled. Campaign is in production mode.`);
    } catch (error) {
      if (uploadedMedia && !uploadedMediaPersisted) {
        await fetch(`/api/media/${encodeURIComponent(uploadedMedia.assetId)}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            publicId: uploadedMedia.publicId,
            resourceType: uploadedMedia.resourceType,
          }),
        }).catch(() => null);
      }
      setCampaignSaveError(error instanceof Error ? error.message : "The Buffer campaign could not be scheduled.");
    } finally {
      setBusy(false);
    }
  };

  const syncBufferPosts = async (campaignId?: number | string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/buffer/posts/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: campaignId || null }),
      });
      const data = await response.json() as { checked?: number; error?: string; message?: string };
      if (!response.ok && response.status !== 207) {
        throw new Error(data.error || data.message || "Buffer post status could not be synchronized.");
      }
      await load();
      notify(`Synchronized ${data.checked || 0} Buffer post${data.checked === 1 ? "" : "s"}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Buffer post status could not be synchronized.");
    } finally {
      setBusy(false);
    }
  };

  const saveLead = async (lead: LeadInput) => {
    setBusy(true);
    try {
      const isSocialLead = typeof editingLead?.id === "string" && editingLead.id.startsWith("social:");
      const response = await fetch("/api/social/leads", {
        method: isSocialLead ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(isSocialLead ? { leadId: Number(String(editingLead.id).slice("social:".length)) } : {}),
          ...lead,
        }),
      });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.message || data.error || "Could not save lead");
      await load();
      setModal("");
      setEditingLead(null);
      notify(editingLead ? "Lead updated successfully" : "Lead saved successfully");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save lead");
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (type: string, id: number | string, status: string) => {
    if (type === "campaign" && typeof id === "string" && id.startsWith("campaign:")) {
      const response = await fetch("/api/social/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "campaign.mode", id, mode: status.toLowerCase() }),
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) {
        notify(data.error || data.message || "Campaign readiness validation failed");
        await load();
        return;
      }
      await load();
      notify(`Campaign mode updated to ${status.toLowerCase()}`);
      return;
    }
    if (typeof id === "string" && id.startsWith("social:")) {
      const response = await fetch("/api/social/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: Number(id.slice("social:".length)), status }),
      });
      if (!response.ok) {
        notify("Social lead status could not be updated");
        return;
      }
      await load();
      notify(`Lead moved to ${status}`);
      return;
    }
    if (typeof id === "number" && id < 0) {
      setLeads((x) =>
        x.map((l) => (l.id === id ? { ...l, status } : l))
      );
      notify(`Lead moved to ${status}`);
      return;
    }
    await fetch("/api/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: `${type}.status`,
        id,
        status,
      }),
    });
    await load();
    notify(`Status updated to ${status}`);
  };

  const viewLead360 = async (lead: Lead) => {
    if (!(typeof lead.id === "string" && lead.id.startsWith("social:"))) {
      notify("The 360 timeline is available for SQL-backed social leads");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/social/leads/${lead.id.slice("social:".length)}`, { cache: "no-store" });
      const data = await response.json() as UnifiedLead & { message?: string; error?: string };
      if (!response.ok) throw new Error(data.message || data.error || "Could not load the lead timeline");
      setUnifiedLead(data);
      setModal("lead360");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load the lead timeline");
    } finally {
      setBusy(false);
    }
  };

  const runSproutOperation = async (operation: "test" | "sync" | "metrics") => {
    setBusy(true);
    try {
      const response = await fetch("/api/social/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation }),
      });
      const data = await response.json() as { integration?: SocialIntegration; result?: { processed?: number; duplicates?: number }; metrics?: { profiles?: unknown[]; posts?: unknown[] }; message?: string; error?: string };
      if (!response.ok) throw new Error(data.message || data.error || `Sprout ${operation} failed`);
      await load();
      notify(operation === "test"
        ? "Sprout customer access validated"
        : operation === "metrics"
          ? `Sprout metrics refreshed: ${data.metrics?.posts?.length || 0} posts`
          : `Sprout sync completed: ${data.result?.processed || 0} new, ${data.result?.duplicates || 0} duplicate`);
    } catch (error) {
      notify(error instanceof Error ? error.message : `Sprout ${operation} failed`);
    } finally {
      setBusy(false);
    }
  };

  const totalValue = leads.reduce((n, l) => n + l.value, 0);

  return (
    <main className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <span>360</span>
          </div>
          <div className="brand-copy">
            <strong>Alianza</strong>
            <small>CRM • MARKETING</small>
          </div>
          <button
            className="collapse"
            onClick={() => setCollapsed(!collapsed)}
          >
            ‹
          </button>
        </div>
        <nav>
          <p className="nav-label">WORKSPACE</p>
          {nav.slice(0, 7).map(([i, n]) => (
            <button
              key={n}
              className={active === n ? "active" : ""}
              onClick={() => setActive(n)}
            >
              <span className="nav-icon">{i}</span>
              <span>{n}</span>
              {n === "Leads" && <b>{leads.length}</b>}
            </button>
          ))}
          <p className="nav-label second">SYSTEM</p>
          {authUser?.role === "ADMIN" && <>
            <button
              className={active === "Settings" ? "active" : ""}
              onClick={() => setActive("Settings")}
            >
              <span className="nav-icon">⚙</span>
              <span>Settings</span>
            </button>
            <button
              className={active === "User Management" ? "active" : ""}
              onClick={() => setActive("User Management")}
            >
              <span className="nav-icon">♙</span>
              <span>User Management</span>
            </button>
          </>}
        </nav>
        <div className="ai-card">
          <div className="ai-orb">✦</div>
          <div>
            <strong>AI Agent is active</strong>
            <small>
              {connected ? "Listening across 3 channels" : "Ready for connections"}
            </small>
          </div>
          <i />
        </div>
        <div className="profile">
          <div className="avatar">{authUser?.username.slice(0, 2).toUpperCase() || "…"}</div>
          <div>
            <strong>{authUser?.username || "Loading…"}</strong>
            <small>{authUser?.role || "Authenticated user"}</small>
          </div>
          <button className="logout-button" onClick={async () => {
            setBusy(true);
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
            router.replace("/login");
          }} disabled={busy}>Sign out</button>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p>CRM MARKETING FUNNEL 360</p>
            <h1>{active}</h1>
          </div>
          <div className="top-actions">
            <label className="search">
              <span>⌕</span>
              <input placeholder="Search leads, campaigns..." />
            </label>
            <button
              className="primary"
              onClick={() => {
                setActive("Campaigns");
                setModal("ai");
              }}
            >
              ✦ Create with AI
            </button>
          </div>
        </header>
        <div className="content">
          {dataError && <p className="backend-config-message" role="alert">{dataError}</p>}
          {active === "Overview" && (
            <Overview
              leads={leads}
              campaigns={campaigns}
              totalValue={totalValue}
              setActive={setActive}
            />
          )}
          {active === "Leads" && (
            <Leads
              leads={leads}
              onAdd={() => {
                setEditingLead(null);
                setModal("lead");
              }}
              onEdit={(lead) => {
                setEditingLead(lead);
                setModal("lead");
              }}
              onView={viewLead360}
              changeStatus={changeStatus}
            />
          )}
          {active === "Campaigns" && (
            <Campaigns
              rows={campaigns}
              onCreate={() => {
                setCampaignSaveError("");
                setEditingCampaign(null);
                setCampaignPublishDefault(datetimeLocalValue(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()));
                setModal("campaign");
              }}
              onEdit={(campaign) => {
                setCampaignSaveError("");
                setEditingCampaign(campaign);
                setCampaignPublishDefault(datetimeLocalValue(campaign.publishDateTime));
                setModal("campaign");
              }}
              syncBuffer={syncBufferPosts}
              busy={busy}
            />
          )}
          {active === "Funnel" && <Funnel leads={leads} />}
          {active === "Landing Pages" && (
            <LandingPages
              rows={pages}
              onCreate={() => {
                setEditingPage(null);
                setModal("page");
              }}
              onEdit={(page) => {
                setEditingPage(page);
                setModal("page");
              }}
            />
          )}
          {active === "Webinar" && (
            <Webinar
              pages={pages}
              webinars={webinars}
              setActive={setActive}
              onCreate={() => {
                setEditingWebinar(null);
                setModal("webinar");
              }}
              onEdit={(webinar) => {
                setEditingWebinar(webinar);
                setModal("webinar");
              }}
            />
          )}
          {active === "Social Listener" && (
            <Social
              connected={connected}
              leads={leads}
              socialChannels={socialChannels}
              testMessage={testMessage}
              onTestConnection={handleTestConnection}
              testing={testing}
              onTestChannel={handleTestChannel}
              channelTestResults={channelTestResults}
              onConfigure={() => authUser?.role === "ADMIN"
                ? setActive("Settings")
                : notify("Administrator access is required for Settings")}
              integrations={socialIntegrations}
              integrationActions={integrationActions}
              onSproutOperation={runSproutOperation}
              busy={busy}
            />
          )}
          {active === "Settings" && authUser?.role === "ADMIN" && (
            <Settings
              bufferConnection={bufferConnection}
              bufferChannels={bufferChannels}
              onRefreshBuffer={loadBufferChannels}
              onBackendConfigured={async () => {
                await Promise.all([load(), loadSocialStatus(), loadBufferChannels()]);
              }}
            />
          )}
          {active === "User Management" && authUser?.role === "ADMIN" && <UserManagement />}
        </div>
      </section>
      {modal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setModal("");
              setCampaignSaveError("");
            }
          }}
        >
          <div className="modal">
            <button
              className="modal-close"
              onClick={() => {
                setModal("");
                setCampaignSaveError("");
              }}
            >
              ×
            </button>
            {modal === "lead" && (
              <LeadForm
                key={editingLead?.id || "new"}
                lead={editingLead}
                save={saveLead}
                busy={busy}
              />
            )}
            {modal === "campaign" && (
              <CampaignForm
                key={editingCampaign?.id || "new"}
                campaign={editingCampaign}
                bufferChannels={bufferChannels}
                bufferConnection={bufferConnection}
                defaultPublishTime={campaignPublishDefault}
                save={saveBufferCampaign}
                saveError={campaignSaveError}
                dismissSaveError={() => setCampaignSaveError("")}
                busy={busy}
              />
            )}
            {modal === "page" && <PageForm key={editingPage?.id || "new"} page={editingPage} campaigns={campaigns} submit={submit} busy={busy} />}
            {modal === "webinar" && <WebinarForm key={editingWebinar?.id || "new"} webinar={editingWebinar} submit={submit} busy={busy} campaigns={campaigns} pages={pages} />}
            {modal === "ai" && <AiDraftForm busy={busy} setBusy={setBusy} onSaved={async (message) => { await load(); setModal(""); notify(message); }} />}
            {modal === "lead360" && unifiedLead && <Lead360View data={unifiedLead} />}
          </div>
        </div>
      )}
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}

function Overview({
  leads,
  campaigns,
  totalValue,
  setActive,
}: {
  leads: Lead[];
  campaigns: Campaign[];
  totalValue: number;
  setActive: (x: string) => void;
}) {
  return (
    <>
      <section className="welcome">
        <div>
          <h2>Your growth engine is ready.</h2>
          <p>Track every contact from social conversation to paid subscription.</p>
        </div>
        <span className="system-badge">● ALL SYSTEMS READY</span>
      </section>
      <section className="metric-grid">
        {[
          [
            "♙",
            "Total leads",
            leads.length,
            "+24.8%",
            "coral",
          ],
          [
            "◈",
            "Conversion rate",
            "18.6%",
            "+8.2%",
            "violet",
          ],
          [
            "＄",
            "Pipeline value",
            `$${totalValue.toLocaleString()}`,
            "+31.5%",
            "mint",
          ],
          [
            "◎",
            "Active campaigns",
            campaigns.filter((x) => ["active", "production"].includes(x.status.toLowerCase())).length,
            "Live",
            "amber",
          ],
        ].map(([i, n, v, d, c]) => (
          <article key={n as string}>
            <div className="metric-top">
              <span className={`metric-icon ${c as string}`}>{i}</span>
              <em>{d}</em>
            </div>
            <p>{n}</p>
            <h3>{v}</h3>
            <small>Live CRM data</small>
          </article>
        ))}
      </section>
      <section className="main-grid">
        <article className="panel funnel-panel">
          <div className="panel-head">
            <div>
              <h3>Marketing funnel</h3>
              <p>Audience to subscription journey</p>
            </div>
            <button
              className="ghost"
              onClick={() => setActive("Funnel")}
            >
              Manage funnel →
            </button>
          </div>
          <div className="funnel-bars">
            {[
              ["Social reach", 84200, 100],
              ["Engaged", 12800, 62],
              ["Leads", leads.length, 40],
              ["Webinar", Math.round(leads.length * 0.48), 25],
              ["Customers", Math.round(leads.length * 0.18), 12],
            ].map(([n, v, w]) => (
              <div key={n as string}>
                <span>{n}</span>
                <i>
                  <b style={{ width: `${(w as number) * 1}%` }} />
                </i>
                <strong>{Number(v).toLocaleString()}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="panel ai-panel">
          <div className="panel-head">
            <div>
              <h3>AI Growth Agent</h3>
              <p>Live intelligence</p>
            </div>
            <span className="live">● LIVE</span>
          </div>
          <div className="insight-tag">✦ OPPORTUNITY DETECTED</div>
          <h4>Your wellness audience is 2.4× more active right now.</h4>
          <p className="body-copy">
            Conversation intent is peaking around &ldquo;team burnout.&rdquo; Create a focused
            campaign while interest is high.
          </p>
          <button
            className="dark-button"
            onClick={() => setActive("Campaigns")}
          >
            Create campaign now →
          </button>
        </article>
      </section>
    </>
  );
}

function Leads({
  leads,
  onAdd,
  onEdit,
  onView,
  changeStatus,
}: {
  leads: Lead[];
  onAdd: () => void;
  onEdit: (lead: Lead) => void;
  onView: (lead: Lead) => void;
  changeStatus: (t: string, id: number | string, s: string) => void;
}) {
  const [q, setQ] = useState("");
  const shown = leads.filter((l) =>
    (l.name + l.email + l.source)
      .toLowerCase()
      .includes(q.toLowerCase())
  );
  return (
    <>
      <ModuleHead
        title="Lead CRM"
        sub="Every lead, conversation and next step in one place"
        action="+ Add lead"
        click={onAdd}
      />
      <div className="toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or source..."
        />
        <span>{shown.length} contacts</span>
      </div>
      <article className="panel data-panel">
        <div className="data-table lead-cols table-head">
          <span>Contact</span>
          <span>Source</span>
          <span>Last Intent</span>
          <span>AI Response</span>
          <span>Stage</span>
        </div>
        {shown.map((l) => (
          <div className="data-table lead-cols" key={l.id}>
            <span className="contact">
              <i>{l.name.split(" ").map((x) => x[0]).join("")}</i>
              <b>
                {l.name}
                <small>{l.email}</small>
              </b>
            </span>
            <span className="lead-source-cell">
              {l.source}
              {typeof l.leadScore === "number" && <small>{l.leadTemperature || "COLD"} · {l.leadScore} pts</small>}
            </span>
            <span className="lead-intent-cell">{(l.intent || "—").replaceAll("_", " ")}</span>
            <span className="lead-ai-response-cell" title={l.crmNotes || ""}>{l.crmNotes || "—"}</span>
            <span className="lead-actions">
              <select
                value={l.status}
                onChange={(e) => changeStatus("lead", l.id, e.target.value)}
              >
                <option>New</option>
                <option>Engaged</option>
                <option>Hot</option>
                <option>Registered</option>
                <option>Customer</option>
              </select>
              <button className="ghost" type="button" onClick={() => onView(l)}>360</button>
              <button className="ghost" type="button" onClick={() => onEdit(l)}>Edit</button>
            </span>
          </div>
        ))}
      </article>
    </>
  );
}

function Campaigns({
  rows,
  onCreate,
  onEdit,
  syncBuffer,
  busy,
}: {
  rows: Campaign[];
  onCreate: () => void;
  onEdit: (campaign: Campaign) => void;
  syncBuffer: (campaignId?: number | string) => Promise<void>;
  busy: boolean;
}) {
  return (
    <>
      <ModuleHead
        title="Campaign Studio"
        sub="Create SQL-backed campaigns and schedule every social post through Buffer"
        action="New Buffer campaign"
        click={onCreate}
      />
      {!rows.length ? (
        <Empty
          icon="◎"
          title="No campaigns yet"
          text="Connect Buffer, select live channels, and schedule your first campaign. SQL remains the source of truth for every post."
          action="Create campaign"
          click={onCreate}
        />
      ) : (
        <div className="card-grid">
          {rows.map((c) => {
            const posts = c.campaignPosts || [];
            const activePosts = posts.filter((post) => post.isActive !== false);
            return (
            <article className="panel campaign-card" key={c.id}>
              <div>
                <span className="platform">Buffer · {c.postType || "POST"} · {c.platform || "No channels"}</span>
                <b className={`status ${c.status.toLowerCase()}`}>
                  {c.status}
                </b>
              </div>
              <h3>{c.name}</h3>
              <p>{c.postText || c.message}</p>
              <small>Objective: {c.campaignObjective || c.audience}</small>
              <div className="campaign-metrics">
                <span>
                  <b>{activePosts.length}</b> active channel posts
                </span>
                <span>
                  <b>{formatSocialTime(c.publishDateTime || posts[0]?.scheduledAt || null)}</b> publish time
                </span>
                <span>
                  <b>{c.aiReplyEnabled ? "On" : "Off"}</b> AI reply
                </span>
              </div>
              {c.mediaUrl && (
                <div className="campaign-media-summary">
                  {c.mediaType === "video" ? (
                    <video src={c.mediaUrl} controls muted preload="metadata" />
                  ) : (
                    <div className="campaign-media-image" role="img" aria-label={c.mediaOriginalName || "Campaign image"} style={{ backgroundImage: `url(${c.mediaUrl})` }} />
                  )}
                  <small>{c.mediaOriginalName || c.mediaMimeType || "Campaign media"}{c.mediaSizeBytes ? ` · ${formatFileSize(c.mediaSizeBytes)}` : ""}</small>
                </div>
              )}
              {c.highIntentKeywords && <small>High-intent keywords: {c.highIntentKeywords}</small>}
              {posts.length ? (
                <div className="buffer-post-list">
                  {posts.map((post) => (
                    <div key={post.id} className={`buffer-post ${post.postStatus.toLowerCase()}${post.isActive === false ? " inactive" : ""}`}>
                      <span>
                        <strong>{post.platform === "twitter" ? "X" : post.platform}</strong>
                        <b>{post.isActive === false ? `HISTORY · ${post.postStatus}` : post.postStatus}</b>
                      </span>
                      <small>Buffer post: {post.bufferPostId || "Not created"}</small>
                      <small>{post.publishedAt ? `Published ${formatSocialTime(post.publishedAt)}` : `Scheduled ${formatSocialTime(post.scheduledAt)}`}</small>
                      {post.postUrl && <a href={post.postUrl} target="_blank" rel="noreferrer">Open published post</a>}
                      {post.errorMessage && <em>{post.errorSource}: {post.errorMessage}</em>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="buffer-post-list"><small>This legacy campaign has no Buffer post records.</small></div>
              )}
              <div className="card-actions">
                <button type="button" disabled={busy} onClick={() => onEdit(c)}>Edit campaign</button>
                <button type="button" disabled={busy || !posts.some((post) => post.bufferPostId && post.postStatus !== "PUBLISHED")} onClick={() => void syncBuffer(c.id)}>
                  Refresh Buffer status
                </button>
              </div>
            </article>
          );})}
        </div>
      )}
    </>
  );
}

function Lead360View({ data }: { data: UnifiedLead }) {
  const interactionHistory = data.interactions
    .filter((item) => ["COMMENT", "REPLY", "DM", "DIRECT_MESSAGE", "STORY_REPLY"].includes(item.interactionType))
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
  const latestInteraction = interactionHistory[0];
  const scoreComponents = [
    ["Intent", data.lead.intentScore || 0, 35],
    ["Engagement", data.lead.engagementScore || 0, 20],
    ["Fit", data.lead.fitScore || 0, 15],
    ["Recency", data.lead.recencyScore || 0, 15],
    ["Source", data.lead.sourceScore || 0, 15],
  ] as const;
  const displayInteractionType = (value: string) =>
    ["DIRECT_MESSAGE", "STORY_REPLY"].includes(value) ? "DM" : value.replaceAll("_", " ");

  return (
    <section className="lead-360">
      <span className="insight-tag">UNIFIED LEAD TIMELINE</span>
      <h2>{data.lead.name}</h2>
      <p>One CRM record across advertisements, organic engagement, messages, forms, opportunities and conversions.</p>
      <div className="lead-360-score">
        <strong>{data.lead.leadScore || 0}</strong>
        <span>{data.lead.scoreBand || data.lead.leadTemperature || "COLD"}<small>score band</small></span>
        <span>{(data.lead.intent || "OTHER").replaceAll("_", " ")}<small>latest intent</small></span>
        <span>{data.lead.status}<small>CRM stage</small></span>
      </div>
      <div className="lead-score-explanation">
        <div className="lead-score-components">
          {scoreComponents.map(([label, value, maximum]) => (
            <span key={label}><b>{value}/{maximum}</b><small>{label}</small></span>
          ))}
        </div>
        <p>{data.lead.scoreReason || "This lead has not yet been scored from social interaction history."}</p>
      </div>
      <article className="latest-lead-interaction">
        <div>
          <span className="insight-tag">LATEST COMMENT OR DM</span>
          {latestInteraction ? (
            <div className="interaction-labels">
              <b>{displayInteractionType(latestInteraction.interactionType)}</b>
              <b className={latestInteraction.direction.toLowerCase()}>{latestInteraction.direction}</b>
              <b>{latestInteraction.platform}</b>
            </div>
          ) : null}
        </div>
        {latestInteraction ? (
          <>
            <p>{latestInteraction.message || latestInteraction.intent.replaceAll("_", " ")}</p>
            <time>{formatSocialTime(latestInteraction.occurredAt)}</time>
          </>
        ) : (
          <p>No comment or DM has been recorded for this lead.</p>
        )}
      </article>
      <div className="lead-360-grid">
        <article>
          <h3>Contact and qualification</h3>
          <dl>
            <div><dt>Email</dt><dd>{data.lead.email || "—"}</dd></div>
            <div><dt>Phone</dt><dd>{data.lead.phone || "—"}</dd></div>
            <div><dt>Company</dt><dd>{data.lead.company || "—"}</dd></div>
            <div><dt>Interest</dt><dd>{data.lead.productServiceInterest || "—"}</dd></div>
            <div><dt>Owner</dt><dd>{data.lead.assignedSalesperson || "Unassigned"}</dd></div>
            <div><dt>Source</dt><dd>{data.lead.source || "Manual"}</dd></div>
            <div><dt>Platform</dt><dd>{latestInteraction?.platform || data.socialAccounts[0]?.platform || "—"}</dd></div>
            <div><dt>Last interaction</dt><dd>{formatSocialTime(data.lead.lastInteractionAt || latestInteraction?.occurredAt || null)}</dd></div>
          </dl>
        </article>
        <article>
          <h3>Social identities</h3>
          {data.socialAccounts.length ? data.socialAccounts.map((account) => (
            <div className="social-identity" key={account.id}>
              <b>{account.platform}</b>
              <span>{account.username || account.displayName || account.platformUserId}</span>
            </div>
          )) : <p>No verified account links yet.</p>}
        </article>
      </div>
      <div className="lead-360-related">
        <span><b>{data.interactions.length}</b> interactions</span>
        <span><b>{data.conversations.length}</b> conversations</span>
        <span><b>{data.opportunities.length}</b> opportunities</span>
        <span><b>{data.quotes.length}</b> quotes</span>
        <span><b>{data.appointments.length}</b> appointments</span>
        <span><b>{data.conversionHistory.length}</b> conversions</span>
      </div>
      <h3>Comment and DM history</h3>
      <div className="lead-360-timeline">
        {interactionHistory.length ? interactionHistory.map((item) => (
          <div key={item.id}>
            <i />
            <span>
              <strong className="interaction-history-heading">
                <b>{displayInteractionType(item.interactionType)}</b>
                <b className={item.direction.toLowerCase()}>{item.direction}</b>
                <b>{item.platform}</b>
              </strong>
              <small>{item.message || item.intent}</small>
              <em>{item.intent.replaceAll("_", " ")} · {item.sentiment} · {item.sourceType}</em>
            </span>
            <time>{formatSocialTime(item.occurredAt)}</time>
          </div>
        )) : <p>No comment or DM history has been recorded yet.</p>}
      </div>
    </section>
  );
}

function Funnel({ leads }: { leads: Lead[] }) {
  const stages = ["New", "Engaged", "Hot", "Registered", "Customer"];
  return (
    <>
      <ModuleHead
        title="Sales Funnel"
        sub="Move leads through the complete webinar conversion journey"
      />
      <div className="kanban">
        {stages.map((s) => (
          <section key={s}>
            <header>
              <span>{s}</span>
              <b>{leads.filter((l) => l.status === s).length}</b>
            </header>
            {leads
              .filter((l) => l.status === s)
              .map((l) => (
                <article key={l.id}>
                  <strong>{l.name}</strong>
                  <small>{l.source}</small>
                  <p>${l.value.toLocaleString()}</p>
                </article>
              ))}
            {!leads.some((l) => l.status === s) && (
              <div className="empty-slot">No leads in this stage</div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

function LandingPages({
  rows,
  onCreate,
  onEdit,
}: {
  rows: Landing[];
  onCreate: () => void;
  onEdit: (page: Landing) => void;
}) {
  return (
    <>
      <ModuleHead
        title="Landing Pages"
        sub="Capture contact details and start your webinar immediately after registration"
        action="+ Build page"
        click={onCreate}
      />
      {!rows.length ? (
        <Empty
          icon="▱"
          title="Build your first conversion page"
          text="Add a teaser, registration form, webinar link and payment destination in one guided setup."
          action="Build landing page"
          click={onCreate}
        />
      ) : (
        <div className="card-grid">
          {rows.map((p) => (
            <article className="panel page-card" key={p.id}>
              <span className="status registered">{p.status}</span>
              <h3>{p.title}</h3>
              <p>{p.headline}</p>
              <small>/{p.slug}</small>
              <div>
                <b>{p.registrations}</b> registrations
              </div>
              <div className="card-actions">
                <button type="button" onClick={() => onEdit(p)}>Edit page</button>
                <button
                  type="button"
                  onClick={() => window.open(`/landing/${p.slug}`, "_blank")}
                >
                  Open page ↗
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function Webinar({
  pages,
  webinars,
  setActive,
  onCreate,
  onEdit,
}: {
  pages: Landing[];
  webinars: WebinarRecord[];
  setActive: (x: string) => void;
  onCreate: () => void;
  onEdit: (webinar: WebinarRecord) => void;
}) {
  return (
    <>
      <ModuleHead
        title="Webinar Center"
        sub="Turn captured leads into subscribers with an immediate video experience"
        action="+ New webinar"
        click={onCreate}
      />
      {webinars.length > 0 && (
        <div className="card-grid" style={{ marginBottom: "18px" }}>
          {webinars.map((webinar) => (
            <article className="panel" key={webinar.id}>
              <span className="status registered">{webinar.status}</span>
              <h3>{webinar.title}</h3>
              <p>{webinar.description || "No description"}</p>
              <small>{webinar.scheduledAt ? new Date(webinar.scheduledAt).toLocaleString() : "Schedule not set"}</small>
              <div className="card-actions">
                <button type="button" onClick={() => onEdit(webinar)}>Edit webinar</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <article className="panel webinar-builder">
        <div className="video-placeholder">
          <span>▶</span>
          <strong>Webinar preview</strong>
          <small>Your video begins immediately after registration</small>
        </div>
        <div>
          <span className="insight-tag">CONVERSION FLOW</span>
          <h2>Teaser → Registration → Webinar → Payment</h2>
          <p>
            Each published landing page can carry its own teaser, hosted webinar
            link and payment checkout. Registrations flow directly into Leads.
          </p>
          <ul>
            <li>Immediate video playback after submit</li>
            <li>Payment button displayed beside the webinar</li>
            <li>AI follow-up activity logged in the CRM</li>
          </ul>
          <button
            className="primary"
            onClick={() => setActive("Landing Pages")}
          >
            {pages.length
              ? "Manage webinar pages"
              : "Create webinar page"}
          </button>
        </div>
      </article>
    </>
  );
}

function formatSocialTime(value: string | null) {
  if (!value) return "Not yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function channelRequirement(channel: SocialChannelConfig["channel"]) {
  if (channel === "instagram") {
    return "META_ACCESS_TOKEN + INSTAGRAM_ACCOUNT_ID";
  }
  if (channel === "facebook") {
    return "META_ACCESS_TOKEN + FACEBOOK_PAGE_ID";
  }
  return "X_BEARER_TOKEN";
}

function Social({
  connected,
  leads,
  socialChannels,
  testMessage,
  onTestConnection,
  testing,
  onTestChannel,
  channelTestResults,
  onConfigure,
  integrations,
  integrationActions,
  onSproutOperation,
  busy,
}: {
  connected: boolean;
  leads: Lead[];
  socialChannels: SocialChannelConfig[];
  testMessage: string;
  onTestConnection: () => Promise<string>;
  testing: boolean;
  onTestChannel: (channelName: string) => Promise<void>;
  channelTestResults: { [key: string]: string };
  onConfigure: () => void;
  integrations: SocialIntegration[];
  integrationActions: IntegrationAction[];
  onSproutOperation: (operation: "test" | "sync" | "metrics") => Promise<void>;
  busy: boolean;
}) {
  const connectedCount = socialChannels.filter(
    (channel) => channel.status === "connected"
  ).length;
  const sprout = integrations.find((integration) => integration.provider === "sprout");
  const recentActions = integrationActions.slice(0, 6);

  return (
    <>
      <ModuleHead
        title="Social Listener"
        sub="Monitor intent, normalize conversations and route qualified prospects into CRM"
      />

      <article className="panel integration-control-plane">
        <div className="integration-control-head">
          <div>
            <span className="insight-tag">CRM CONTROL PLANE</span>
            <h3>Sprout Social integration</h3>
            <p>The CRM owns campaign decisions, lead state, workflows and history. Sprout is the delivery and listening adapter.</p>
          </div>
          <span className={`integration-state ${sprout?.status === "connected" ? "connected" : ""}`}>
            {(sprout?.status || "missing_configuration").replaceAll("_", " ")}
          </span>
        </div>
        <div className="integration-summary">
          <span><strong>{sprout?.profileCount || 0}</strong> profiles</span>
          <span><strong>{sprout?.listeningTopicCount || 0}</strong> listening topics</span>
          <span><strong>{sprout?.publishingReady ? "Ready" : "Setup needed"}</strong> draft publishing</span>
          <span><strong>{recentActions.length}</strong> recent events</span>
        </div>
        <p className="integration-reason">{sprout?.reason || "Add the Sprout server variables to enable this adapter."}</p>
        {!sprout?.publishingReady && Boolean(sprout?.publishingMissing?.length) && (
          <small className="integration-missing">Publishing needs: {sprout?.publishingMissing.join(", ")}</small>
        )}
        <div className="integration-buttons">
          <button className="ghost" type="button" disabled={busy} onClick={() => void onSproutOperation("test")}>Test Sprout access</button>
          <button className="ghost" type="button" disabled={busy || !sprout?.configured} onClick={() => void onSproutOperation("metrics")}>Refresh metrics</button>
          <button className="primary" type="button" disabled={busy || !sprout?.configured} onClick={() => void onSproutOperation("sync")}>Sync engagement to CRM</button>
        </div>
        <div className="integration-ledger">
          <div className="integration-ledger-head"><span>Direction</span><span>CRM action</span><span>Delivery</span><span>External ID</span><span>Updated</span></div>
          {recentActions.length ? recentActions.map((action) => (
            <div key={action.id}>
              <span>{action.direction}</span>
              <span>{action.eventType.replaceAll("_", " ")}</span>
              <span className={`ledger-status ${action.status.toLowerCase()}`}>{action.status.replaceAll("_", " ")}</span>
              <span>{action.externalId || "-"}</span>
              <span>{formatSocialTime(action.processedAt || action.createdAt)}</span>
            </div>
          )) : <p>No integration events have been recorded yet.</p>}
        </div>
      </article>

      <article className="panel" style={{ marginBottom: "14px", display: "grid", gap: "12px" }}>
        <div className="panel-head">
          <div>
            <h3>Listener health</h3>
            <p>Real provider checks using server-managed credentials</p>
          </div>
          <span
            className="live"
            style={{
              background: connected ? "#e8f8f1" : "#f4f4f1",
              color: connected ? "#1f8a5d" : "#7a7f89",
              padding: "7px 10px",
              borderRadius: "999px",
              fontSize: "9px",
              fontWeight: 800,
            }}
          >
            ● {connected ? `${connectedCount} ACTIVE` : "PAUSED"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "10px 12px",
            background: connected ? "#e8f8f1" : "#f5f5f2",
            borderRadius: "10px",
            border: "1px solid #eceae3",
          }}
        >
          <small style={{ color: connected ? "#1f8a5d" : "#6e727c", lineHeight: 1.5 }}>
            {testing ? "Testing provider identities…" : testMessage}
          </small>
          <div className="listener-health-actions">
            {!connected && <button className="ghost" onClick={onConfigure}>Configure backend</button>}
            <button className="primary" onClick={() => void onTestConnection()} disabled={testing}>
              {testing ? "Testing..." : "Test all channels"}
            </button>
          </div>
        </div>
      </article>

      <div className="connection-grid">
        {socialChannels.map((channel) => {
          const isConnected = channel.status === "connected";
          return (
            <article
              className="panel connection"
              key={channel.channel}
              style={{ display: "grid", gap: "12px", padding: "16px" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <div>
                  <h3 style={{ margin: "0 0 4px", fontSize: "14px" }}>{channel.name}</h3>
                  <small
                    style={{
                      color: isConnected ? "#1c9a63" : "#7a7f89",
                      fontWeight: 800,
                      textTransform: "uppercase",
                    }}
                  >
                    {channel.status.replaceAll("_", " ")}
                  </small>
                </div>
                <button
                  className={isConnected ? "connected" : ""}
                  onClick={() => void onTestChannel(channel.name)}
                  disabled={channelTestResults[channel.name] === "Testing..."}
                >
                  {channelTestResults[channel.name] === "Testing..." ? "Testing..." : "Test"}
                </button>
              </div>
              <p style={{ color: "#7a7f89", fontSize: "10px", lineHeight: 1.5, margin: 0 }}>
                {channel.reason}
              </p>
              <div className="campaign-metrics" style={{ margin: "2px 0" }}>
                <span><b>{channel.eventsProcessed}</b> events</span>
                <span><b>{channel.leadsGenerated}</b> leads</span>
                <span><b>{channel.supportedMetrics.length}</b> metrics</span>
              </div>
              <small style={{ color: "#7a7f89" }}>
                Last check: {formatSocialTime(channel.lastSuccessfulCheck)}
              </small>
              <small style={{ color: "#7a7f89" }}>
                Last event: {formatSocialTime(channel.lastReceivedEvent)}
              </small>
              <small style={{ color: "#7a7f89" }}>
                Server config: {channelRequirement(channel.channel)}
              </small>
            </article>
          );
        })}
      </div>

      <article className="panel listener-feed">
        <div className="panel-head">
          <div>
            <h3>Qualified intent queue</h3>
            <p>Normalized people and source attribution available to the CRM</p>
          </div>
          <span className="live">● {connected ? "LISTENING" : "PAUSED"}</span>
        </div>
        {connected ? (
          leads.slice(0, 3).map((lead) => (
            <div className="signal" key={lead.id}>
              <span>✦</span>
              <div>
                <strong>{lead.name}</strong>
                <p>Showing interest in webinar-related content on {lead.source}.</p>
              </div>
              <button>Send webinar link</button>
            </div>
          ))
        ) : (
          <Empty
            icon="◉"
            title="No provider has been validated"
            text="Configure the backend service, apply the SQL Server migration and run a real provider identity check."
            action="Configure backend service"
            click={onConfigure}
          />
        )}
      </article>
    </>
  );
}

function UserManagement() {
  const router = useRouter();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"create" | "edit" | "password" | "">("");
  const [selected, setSelected] = useState<AuthUser | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { users?: AuthUser[]; error?: string };
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    setError(response.ok ? "" : body.error || "Users could not be loaded.");
    setUsers(body.users || []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  async function request(url: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The user change could not be saved.");
      setDialog("");
      setSelected(null);
      await loadUsers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The user change could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void request("/api/admin/users", "POST", {
      username: data.get("username"),
      password: data.get("password"),
      role: data.get("role"),
      isActive: data.get("isActive") === "on",
    });
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    void request(`/api/admin/users/${selected.id}`, "PATCH", {
      username: data.get("username"),
      role: data.get("role"),
      isActive: data.get("isActive") === "on",
    });
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    void request(`/api/admin/users/${selected.id}/password`, "POST", {
      password: data.get("password"),
    });
  }

  const formatted = (value: string | null) => value
    ? new Date(value).toLocaleString()
    : "Never";

  return (
    <>
      <ModuleHead
        title="User Management"
        sub="Create users, assign roles, manage access, and reset passwords"
        action="+ Create user"
        click={() => { setSelected(null); setDialog("create"); setError(""); }}
      />
      {error && <p className="backend-config-message" role="alert">{error}</p>}
      <section className="panel user-management-panel">
        <div className="user-table user-table-head">
          <span>Username</span><span>Role</span><span>Status</span><span>Created</span><span>Updated</span><span>Last login</span><span>Actions</span>
        </div>
        {loading && <p className="user-loading">Loading users…</p>}
        {!loading && users.length === 0 && <p className="user-loading">No users were returned.</p>}
        {users.map((user) => (
          <div className="user-table" key={user.id}>
            <strong>{user.username}</strong>
            <span className={`role-badge ${user.role.toLowerCase()}`}>{user.role}</span>
            <span className={`user-status ${user.isActive ? "active" : "inactive"}`}>{user.isActive ? "Active" : "Inactive"}</span>
            <time>{formatted(user.createdAt)}</time>
            <time>{formatted(user.updatedAt)}</time>
            <time>{formatted(user.lastLoginAt)}</time>
            <div className="user-actions">
              <button onClick={() => { setSelected(user); setDialog("edit"); setError(""); }}>Edit</button>
              <button onClick={() => void request(`/api/admin/users/${user.id}`, "PATCH", {
                username: user.username,
                role: user.role,
                isActive: !user.isActive,
              })}>{user.isActive ? "Deactivate" : "Activate"}</button>
              <button onClick={() => { setSelected(user); setDialog("password"); setError(""); }}>Password</button>
            </div>
          </div>
        ))}
      </section>

      {dialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !working) setDialog("");
      }}>
        <div className="modal user-modal">
          <button className="modal-close" onClick={() => setDialog("")} disabled={working}>×</button>
          {dialog === "create" && <form onSubmit={submitCreate}>
            <h2>Create user</h2>
            <p>Passwords are hashed on the server and are never returned.</p>
            <Field label="Username" name="username" required />
            <Field label="Temporary password" name="password" type="password" required />
            <label>Role<select name="role" defaultValue="BASIC"><option value="BASIC">BASIC</option><option value="ADMIN">ADMIN</option></select></label>
            <label className="checkbox-field"><input name="isActive" type="checkbox" defaultChecked /> Active</label>
            <small className="password-guidance">Use 10+ characters with uppercase, lowercase, number, and special characters.</small>
            <button className="primary submit" disabled={working}>{working ? "Creating…" : "Create user"}</button>
          </form>}
          {dialog === "edit" && selected && <form onSubmit={submitEdit}>
            <h2>Edit user</h2>
            <p>Update this existing account. Password changes are handled separately.</p>
            <Field label="Username" name="username" defaultValue={selected.username} required />
            <label>Role<select name="role" defaultValue={selected.role}><option value="BASIC">BASIC</option><option value="ADMIN">ADMIN</option></select></label>
            <label className="checkbox-field"><input name="isActive" type="checkbox" defaultChecked={selected.isActive} /> Active</label>
            <button className="primary submit" disabled={working}>{working ? "Saving…" : "Save changes"}</button>
          </form>}
          {dialog === "password" && selected && <form onSubmit={submitPassword}>
            <h2>Reset password</h2>
            <p>Set a replacement password for <strong>{selected.username}</strong>. Existing sessions for this user will be revoked.</p>
            <Field label="New password" name="password" type="password" required />
            <small className="password-guidance">Use 10+ characters with uppercase, lowercase, number, and special characters.</small>
            <button className="primary submit" disabled={working}>{working ? "Updating…" : "Update password"}</button>
          </form>}
        </div>
      </div>}
    </>
  );
}

function Settings({
  bufferConnection,
  bufferChannels,
  onRefreshBuffer,
  onBackendConfigured,
}: {
  bufferConnection: BufferConnection;
  bufferChannels: BufferChannel[];
  onRefreshBuffer: () => Promise<boolean>;
  onBackendConfigured: () => Promise<void>;
}) {
  return (
    <>
      <ModuleHead title="Settings" sub="Configure and verify the server-side services that power your funnel" />
      <div className="settings-grid">
        <BackendServiceConfiguration onConfigured={onBackendConfigured} />
        <article className="panel buffer-settings">
          <div className="panel-head">
            <div>
              <h3>Buffer publishing</h3>
              <p>Campaign channels come directly from Buffer. Credentials remain in server environment variables.</p>
            </div>
            <span className={`integration-state ${bufferConnection.status === "connected" ? "connected" : ""}`}>
              {bufferConnection.status.replaceAll("_", " ")}
            </span>
          </div>
          <p>{bufferConnection.reason}</p>
          <div className="buffer-channel-grid">
            {bufferChannels.length ? bufferChannels.map((channel) => (
              <div key={channel.id}>
                <strong>{channel.displayName}</strong>
                <small>{channel.service === "twitter" ? "X" : channel.service} · {channel.isQueuePaused ? "queue paused" : "available"}</small>
              </div>
            )) : <small>No live Buffer channels are available.</small>}
          </div>
          <button className="primary" type="button" onClick={() => void onRefreshBuffer()}>Test Buffer and refresh channels</button>
          <small className="config-state">Required on the server: BUFFER_API_KEY and BUFFER_ORGANIZATION_ID</small>
        </article>
        <article className="panel">
          <h3>SQL Server persistence</h3>
          <p>
            Social events, processing status, errors, metrics and lead attribution use
            parameterized stored procedures and one idempotent event transaction.
          </p>
          <span className="config-state">
            DB_SERVER, DB_NAME and database credentials required
          </span>
        </article>
        <ScoringSettings />
        <article className="panel">
          <h3>Meta webhooks</h3>
          <p>
            Verification uses META_VERIFY_TOKEN. Deliveries require a valid
            X-Hub-Signature-256 generated with META_APP_SECRET.
          </p>
          <span className="config-state">Server configuration required</span>
        </article>
      </div>
    </>
  );
}

const scoringLabels: Record<string, string> = {
  COMMENT_ON_ADVERTISEMENT: "Comment on advertisement",
  DIRECT_MESSAGE: "Direct message",
  PRICE_REQUEST: "Price request",
  QUOTE_REQUEST: "Quote request",
  PHONE_NUMBER_PROVIDED: "Phone provided",
  EMAIL_PROVIDED: "Email provided",
  APPOINTMENT_REQUEST: "Appointment request",
  DEMO_REQUEST: "Demo request",
  PURCHASE_INTEREST_CONFIRMED: "Purchase interest",
};

function ScoringSettings() {
  const [rules, setRules] = useState<Record<string, number>>({});
  const [thresholds, setThresholds] = useState<Record<string, number>>({ COLD: 0, WARM: 20, HOT: 50, VERY_HOT: 80 });
  const [message, setMessage] = useState("Loading lead-scoring rules...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/social/scoring", { cache: "no-store" });
        const data = await response.json() as { rules?: Record<string, number>; thresholds?: Record<string, number>; message?: string };
        if (!response.ok) throw new Error(data.message || "Scoring configuration is unavailable.");
        setRules(data.rules || {});
        setThresholds(data.thresholds || thresholds);
        setMessage("Rules are active for new social interactions.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Scoring configuration is unavailable.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // The persisted scoring configuration is loaded once for this settings panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/social/scoring", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules, thresholds }),
      });
      const data = await response.json() as { rules?: Record<string, number>; thresholds?: Record<string, number>; message?: string; error?: string };
      if (!response.ok) throw new Error(data.message || data.error || "Scoring rules could not be saved.");
      setRules(data.rules || rules);
      setThresholds(data.thresholds || thresholds);
      setMessage("Lead-scoring rules saved to SQL Server.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scoring rules could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="panel scoring-settings">
      <h3>Lead scoring and temperature</h3>
      <p>Configure the points applied to qualified social interactions and the thresholds used by sales.</p>
      <div className="scoring-rule-grid">
        {Object.entries(rules).map(([key, value]) => (
          <label key={key}>{scoringLabels[key] || key}<input type="number" min="0" max="1000" value={value} onChange={(event) => setRules((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>
        ))}
      </div>
      <div className="temperature-grid">
        {["COLD", "WARM", "HOT", "VERY_HOT"].map((key) => (
          <label key={key}>{key.replace("_", " ")}<input type="number" min="0" value={thresholds[key] ?? 0} onChange={(event) => setThresholds((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>
        ))}
      </div>
      <button className="primary" type="button" disabled={saving || !Object.keys(rules).length} onClick={() => void save()}>{saving ? "Saving..." : "Save scoring rules"}</button>
      <small>{message}</small>
    </article>
  );
}

function BackendServiceConfiguration({ onConfigured }: { onConfigured: () => Promise<void> }) {
  const [config, setConfig] = useState<SocialBackendConfig>({
    configured: false,
    serviceUrl: "",
    tokenStored: false,
    source: null,
    updatedAt: null,
  });
  const [message, setMessage] = useState("Loading configuration...");

  const loadConfiguration = async () => {
    try {
      const response = await fetch("/api/social/config", { cache: "no-store" });
      const data = await response.json() as SocialBackendConfig & { message?: string };
      if (!response.ok) throw new Error(data.message || "Configuration is unavailable.");
      setConfig(data);
      setMessage(data.configured
        ? "Configured securely from the hosting environment."
        : "Set SOCIAL_LISTENER_SERVICE_URL and SOCIAL_LISTENER_SERVICE_TOKEN on the server.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Configuration is unavailable.");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConfiguration(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <article className="panel backend-config-panel">
      <div className="backend-config-head">
        <div>
          <h3>Social Listener backend service</h3>
          <p>The browser calls this server, and this server calls the SQL-backed service. Database credentials are environment-managed and never exposed to the client.</p>
        </div>
        <span className={`config-state ${config.configured ? "ready" : ""}`}>
          {config.configured ? "Backend configured" : "Configuration required"}
        </span>
      </div>
      <div className="backend-config-actions">
        <code>{config.serviceUrl || "Backend URL not exposed until configured"}</code>
        <button className="primary" type="button" onClick={() => void onConfigured()}>Test server connection</button>
      </div>
      <small className="backend-config-message" aria-live="polite">{message}</small>
    </article>
  );
}

/* Removed from the active UI: direct provider credential forms were replaced by server-only Buffer publishing.
const defaultRequiredScopes = (channel: StoredChannelConfiguration["channel"]) => channel === "instagram"
  ? "pages_show_list instagram_basic instagram_manage_comments instagram_manage_messages instagram_content_publish instagram_manage_insights pages_read_engagement pages_manage_metadata ads_read ads_management"
  : channel === "facebook"
    ? "pages_show_list pages_read_engagement pages_manage_posts pages_manage_metadata pages_messaging ads_read ads_management leads_retrieval"
    : "tweet.read users.read tweet.write dm.read dm.write offline.access";

const emptyStoredChannel = (channel: StoredChannelConfiguration["channel"]): StoredChannelConfiguration => ({
  channel,
  enabled: false,
  environment: "production",
  accountId: "",
  pageId: "",
  adAccountId: "",
  businessId: "",
  appId: "",
  clientId: "",
  loginMode: channel === "x" ? "oauth2_pkce" : "facebook_login",
  tokenType: channel === "facebook" ? "page" : "bearer",
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  lastTokenRefreshAt: null,
  nextTokenRefreshAt: null,
  webhookUrl: "",
  callbackUrl: "",
  scopes: "",
  requiredScopes: defaultRequiredScopes(channel),
  grantedScopes: "",
  permissionsValidatedAt: null,
  webhookSubscribedFields: "",
  webhookSubscriptionId: "",
  webhookSubscribedAt: null,
  lastWebhookReceivedAt: null,
  apiVersion: channel === "x" ? "" : "v23.0",
  appMode: "development",
  advancedAccessStatus: channel === "x" ? "not_required" : "not_requested",
  businessVerificationStatus: channel === "x" ? "not_required" : "unverified",
  secretsStored: false,
  secretFields: [],
  status: "missing_configuration",
  lastTestedAt: null,
  lastSuccessAt: null,
  lastError: null,
  productionReadiness: { ready: false, missing: ["Save and validate the channel configuration"], missingScopes: [] },
});

const hydrateStoredChannel = (channel: StoredChannelConfiguration): StoredChannelConfiguration => {
  const defaults = emptyStoredChannel(channel.channel);
  return {
    ...defaults,
    ...channel,
    loginMode: channel.loginMode || defaults.loginMode,
    tokenType: channel.tokenType || defaults.tokenType,
    requiredScopes: channel.requiredScopes || channel.scopes || defaults.requiredScopes,
    appMode: channel.appMode || defaults.appMode,
    advancedAccessStatus: channel.advancedAccessStatus || defaults.advancedAccessStatus,
    businessVerificationStatus: channel.businessVerificationStatus || defaults.businessVerificationStatus,
    productionReadiness: channel.productionReadiness || defaults.productionReadiness,
  };
};

function ChannelConfigurationManager({ onChanged }: { onChanged: () => Promise<void> }) {
  const channelNames: Record<StoredChannelConfiguration["channel"], string> = {
    instagram: "Instagram",
    facebook: "Facebook",
    x: "X",
  };
  const [forms, setForms] = useState<Record<StoredChannelConfiguration["channel"], StoredChannelConfiguration>>({
    instagram: emptyStoredChannel("instagram"),
    facebook: emptyStoredChannel("facebook"),
    x: emptyStoredChannel("x"),
  });
  const [secrets, setSecrets] = useState<Record<string, Record<string, string>>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const [busyChannel, setBusyChannel] = useState("");

  const loadChannels = async () => {
    try {
      const response = await fetch("/api/social/channels", { cache: "no-store" });
      const data = await response.json() as { channels?: StoredChannelConfiguration[]; message?: string };
      if (!response.ok) throw new Error(data.message || "Channel settings are unavailable.");
      setForms((current) => {
        const next = { ...current };
        for (const channel of data.channels || []) {
          next[channel.channel] = hydrateStoredChannel(channel);
        }
        return next;
      });
    } catch (error) {
      setMessage({ all: error instanceof Error ? error.message : "Channel settings are unavailable." });
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void loadChannels(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const update = (channel: StoredChannelConfiguration["channel"], field: keyof StoredChannelConfiguration, value: string | boolean | null) => {
    setForms((current) => ({ ...current, [channel]: { ...current[channel], [field]: value } }));
  };

  const updateSecret = (channel: string, field: string, value: string) => {
    setSecrets((current) => ({ ...current, [channel]: { ...(current[channel] || {}), [field]: value } }));
  };

  const save = async (channel: StoredChannelConfiguration["channel"]) => {
    setBusyChannel(channel);
    setMessage((current) => ({ ...current, [channel]: "Encrypting and saving to SQL..." }));
    try {
      const response = await fetch("/api/social/channels", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...forms[channel],
          authorizationCode: secrets[channel]?.authorizationCode || "",
          codeVerifier: secrets[channel]?.codeVerifier || "",
          secrets: secrets[channel] || {},
        }),
      });
      const data = await response.json() as { channel?: StoredChannelConfiguration; message?: string };
      const savedChannel = data.channel;
      if (!response.ok || !savedChannel) throw new Error(data.message || "Channel configuration could not be saved.");
      setForms((current) => ({ ...current, [channel]: hydrateStoredChannel(savedChannel) }));
      setSecrets((current) => ({ ...current, [channel]: {} }));
      setMessage((current) => ({ ...current, [channel]: data.message || "Saved. Test the provider identity next." }));
      await onChanged();
    } catch (error) {
      setMessage((current) => ({ ...current, [channel]: error instanceof Error ? error.message : "Save failed." }));
    } finally {
      setBusyChannel("");
    }
  };

  const test = async (channel: StoredChannelConfiguration["channel"]) => {
    setBusyChannel(channel);
    setMessage((current) => ({ ...current, [channel]: "Running provider identity check..." }));
    try {
      const response = await fetch("/api/social/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await response.json() as { channel?: StoredChannelConfiguration; message?: string };
      if (data.channel) setForms((current) => ({ ...current, [channel]: { ...current[channel], ...data.channel } }));
      setMessage((current) => ({ ...current, [channel]: data.message || (response.ok ? "Connected." : "Provider test failed.") }));
      await onChanged();
    } catch {
      setMessage((current) => ({ ...current, [channel]: "The listener service could not be reached." }));
    } finally {
      setBusyChannel("");
    }
  };

  const remove = async (channel: StoredChannelConfiguration["channel"]) => {
    setBusyChannel(channel);
    try {
      const response = await fetch("/api/social/channels", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new Error(data.message || "Channel configuration could not be removed.");
      setForms((current) => ({ ...current, [channel]: emptyStoredChannel(channel) }));
      setSecrets((current) => ({ ...current, [channel]: {} }));
      setMessage((current) => ({ ...current, [channel]: "Saved configuration and encrypted credentials removed." }));
      await onChanged();
    } catch (error) {
      setMessage((current) => ({ ...current, [channel]: error instanceof Error ? error.message : "Remove failed." }));
    } finally {
      setBusyChannel("");
    }
  };

  const secretFields = (channel: StoredChannelConfiguration["channel"]) => channel === "x"
    ? ["bearerToken", "accessToken", "refreshToken", "apiKey", "apiSecret", "clientSecret", "webhookSecret"]
    : ["accessToken", "refreshToken", "appSecret", "clientSecret", "verificationToken", "webhookSecret"];

  return (
    <article className="panel" style={{ gridColumn: "1 / -1" }}>
      <h3>SQL-backed channel configuration</h3>
      <p>Enter provider requirements here. Secret values are encrypted before SQL storage, shown only as saved indicators, and never returned to this browser.</p>
      {message.all && <small className="backend-config-message">{message.all}</small>}
      <div style={{ display: "grid", gap: "14px", marginTop: "14px" }}>
        {(["instagram", "facebook", "x"] as const).map((channel) => {
          const form = forms[channel];
          const saving = busyChannel === channel;
          return (
            <details key={channel} open={channel === "instagram"} style={{ border: "1px solid #ecece8", borderRadius: "12px", padding: "14px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                {channelNames[channel]} · {form.status.replaceAll("_", " ")}
                {form.secretsStored ? " · encrypted secrets saved" : " · credentials required"}
              </summary>
              <div className="form-grid" style={{ marginTop: "14px" }}>
                <label>Enabled<select value={form.enabled ? "yes" : "no"} onChange={(e) => update(channel, "enabled", e.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select></label>
                <label>Environment<select value={form.environment} onChange={(e) => update(channel, "environment", e.target.value)}><option value="production">Production</option><option value="test">Test</option><option value="sandbox">Sandbox</option></select></label>
                <label>Provider app mode<select value={form.appMode || "development"} onChange={(e) => update(channel, "appMode", e.target.value)}><option value="development">Development</option><option value="live">Live / production</option></select></label>
                <label>Login mode<select value={form.loginMode || (channel === "x" ? "oauth2_pkce" : "facebook_login")} onChange={(e) => update(channel, "loginMode", e.target.value)}>{channel === "instagram" && <option value="instagram_login">Instagram Login</option>}{channel !== "x" && <option value="facebook_login">Facebook Login for Business</option>}{channel === "x" && <><option value="oauth2_pkce">OAuth 2.0 PKCE</option><option value="app_only">App-only bearer</option></>}</select></label>
                <label>Token type<select value={form.tokenType || "bearer"} onChange={(e) => update(channel, "tokenType", e.target.value)}><option value="bearer">Bearer</option><option value="user">User token</option><option value="page">Page token</option><option value="system_user">System-user token</option><option value="app">App token</option></select></label>
                {channel === "instagram" && <Field label="Instagram professional account ID" name={`${channel}-account`} value={form.accountId || ""} onValueChange={(v) => update(channel, "accountId", v)} />}
                {channel !== "x" && <Field label={channel === "facebook" ? "Facebook Page ID" : "Linked Facebook Page ID"} name={`${channel}-page`} value={form.pageId || ""} onValueChange={(v) => update(channel, "pageId", v)} />}
                {channel !== "x" && <Field label="Meta Ad Account ID" name={`${channel}-ad-account`} placeholder="act_123456789" value={form.adAccountId || ""} onValueChange={(v) => update(channel, "adAccountId", v)} />}
                {channel !== "x" && <Field label="Business portfolio ID" name={`${channel}-business`} value={form.businessId || ""} onValueChange={(v) => update(channel, "businessId", v)} />}
                <Field label="App ID" name={`${channel}-app`} value={form.appId} onValueChange={(v) => update(channel, "appId", v)} />
                <Field label="Client ID" name={`${channel}-client`} value={form.clientId} onValueChange={(v) => update(channel, "clientId", v)} />
                <Field label="API version" name={`${channel}-version`} value={form.apiVersion} onValueChange={(v) => update(channel, "apiVersion", v)} />
                <Field label="Callback URL" name={`${channel}-callback`} type="url" value={form.callbackUrl} onValueChange={(v) => update(channel, "callbackUrl", v)} />
                <Field label="Access token expires" name={`${channel}-access-expires`} type="datetime-local" value={datetimeLocalValue(form.accessTokenExpiresAt)} onValueChange={(v) => update(channel, "accessTokenExpiresAt", v || null)} />
                <Field label="Refresh token expires" name={`${channel}-refresh-expires`} type="datetime-local" value={datetimeLocalValue(form.refreshTokenExpiresAt)} onValueChange={(v) => update(channel, "refreshTokenExpiresAt", v || null)} />
                <label>Last token refresh<input readOnly value={form.lastTokenRefreshAt ? new Date(form.lastTokenRefreshAt).toLocaleString() : "Not recorded"} /></label>
                <label>Next token refresh<input readOnly value={form.nextTokenRefreshAt ? new Date(form.nextTokenRefreshAt).toLocaleString() : "Not scheduled"} /></label>
                <Field label="Required scopes" name={`${channel}-required-scopes`} value={form.requiredScopes || ""} onValueChange={(v) => update(channel, "requiredScopes", v)} />
                <Field label="Granted scopes" name={`${channel}-granted-scopes`} value={form.grantedScopes || ""} onValueChange={(v) => update(channel, "grantedScopes", v)} />
                <Field label="Permissions validated at" name={`${channel}-permissions-validated`} type="datetime-local" value={datetimeLocalValue(form.permissionsValidatedAt)} onValueChange={(v) => update(channel, "permissionsValidatedAt", v || null)} />
                {channel !== "x" && <label>Advanced Access<select value={form.advancedAccessStatus || "not_requested"} onChange={(e) => update(channel, "advancedAccessStatus", e.target.value)}><option value="not_requested">Not requested</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="not_required">Not required</option></select></label>}
                {channel !== "x" && <label>Business verification<select value={form.businessVerificationStatus || "unverified"} onChange={(e) => update(channel, "businessVerificationStatus", e.target.value)}><option value="unverified">Unverified</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="not_required">Not required</option></select></label>}
                <Field label="Webhook URL" name={`${channel}-webhook`} type="url" value={form.webhookUrl} onValueChange={(v) => update(channel, "webhookUrl", v)} />
                <Field label="Webhook subscribed fields" name={`${channel}-webhook-fields`} placeholder="comments messages leadgen" value={form.webhookSubscribedFields || ""} onValueChange={(v) => update(channel, "webhookSubscribedFields", v)} />
                <Field label="Webhook subscription ID" name={`${channel}-webhook-subscription`} value={form.webhookSubscriptionId || ""} onValueChange={(v) => update(channel, "webhookSubscriptionId", v)} />
                <Field label="Webhook subscribed at" name={`${channel}-webhook-subscribed-at`} type="datetime-local" value={datetimeLocalValue(form.webhookSubscribedAt)} onValueChange={(v) => update(channel, "webhookSubscribedAt", v || null)} />
                <label>Last webhook received<input readOnly value={form.lastWebhookReceivedAt ? new Date(form.lastWebhookReceivedAt).toLocaleString() : "No webhook received"} /></label>
                <Field label="OAuth authorization code (one-time, never stored)" name={`${channel}-authorization-code`} type="password" value={secrets[channel]?.authorizationCode || ""} onValueChange={(value) => updateSecret(channel, "authorizationCode", value)} />
                {channel === "x" && <Field label="PKCE code verifier (one-time, never stored)" name={`${channel}-code-verifier`} type="password" value={secrets[channel]?.codeVerifier || ""} onValueChange={(value) => updateSecret(channel, "codeVerifier", value)} />}
                {secretFields(channel).map((field) => (
                  <Field
                    key={field}
                    label={`${field.replace(/([A-Z])/g, " $1")} ${form.secretFields.includes(field) ? "(saved)" : ""}`}
                    name={`${channel}-${field}`}
                    type="password"
                    placeholder={form.secretFields.includes(field) ? "Leave blank to keep saved value" : "Enter secret"}
                    value={secrets[channel]?.[field] || ""}
                    onValueChange={(value) => updateSecret(channel, field, value)}
                  />
                ))}
              </div>
              <div style={{ marginTop: "12px", padding: "12px", borderRadius: "10px", background: form.productionReadiness?.ready ? "#eef9f3" : "#fff7e8" }}>
                <strong style={{ color: form.productionReadiness?.ready ? "#1f8a5d" : "#8a5a14" }}>
                  {form.productionReadiness?.ready ? "Production configuration complete" : "Production configuration incomplete"}
                </strong>
                {!form.productionReadiness?.ready && <ul style={{ margin: "8px 0 0", paddingLeft: "20px", fontSize: "12px" }}>
                  {(form.productionReadiness?.missing || ["Save the configuration to calculate readiness."]).map((item) => <li key={item}>{item}</li>)}
                </ul>}
              </div>
              <p style={{ fontSize: "12px", color: form.status === "connected" ? "#1f8a5d" : "#6e727c" }}>
                {message[channel] || form.lastError || "Save first, then run the real provider test."}
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button className="primary" type="button" disabled={saving} onClick={() => void save(channel)}>{saving ? "Working..." : "Save configuration"}</button>
                <button className="ghost" type="button" disabled={saving} onClick={() => void test(channel)}>Test provider</button>
                <button className="ghost danger-button" type="button" disabled={saving} onClick={() => void remove(channel)}>Remove</button>
              </div>
            </details>
          );
        })}
      </div>
    </article>
  );
}

*/
function ModuleHead({
  title,
  sub,
  action,
  click,
}: {
  title: string;
  sub: string;
  action?: string;
  click?: () => void;
}) {
  return (
    <section className="module-head">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {action && (
        <button className="primary" onClick={click}>
          {action}
        </button>
      )}
    </section>
  );
}

function Empty({
  icon,
  title,
  text,
  action,
  click,
}: {
  icon: string;
  title: string;
  text: string;
  action: string;
  click: () => void;
}) {
  return (
    <div className="empty panel">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="primary" onClick={click}>
        {action}
      </button>
    </div>
  );
}

function Field({
  label,
  name,
  placeholder = "",
  type = "text",
  required = false,
  value,
  defaultValue,
  onValueChange,
}: {
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <label>
      {label}
      {required && <span style={{ color: "#ba3d3d" }}> *</span>}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}
      />
    </label>
  );
}

function LeadForm({
  lead,
  save,
  busy,
}: {
  lead: Lead | null;
  save: (lead: LeadInput) => Promise<void>;
  busy: boolean;
}) {
  const [values, setValues] = useState({
    name: lead?.name || "",
    email: lead?.email || "",
    phone: lead?.phone || "",
    facebook: lead?.facebook || "",
    instagram: lead?.instagram || "",
    x: lead?.x || "",
    source: lead?.source || "Manual",
    value: String(lead?.value || ""),
    lastIntent: lead?.intent || "",
    crmnotes: lead?.crmNotes || "",
  });
  const update = (field: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };
  const submitLead = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const social = values.instagram || values.facebook || values.x;
    void save({ ...values, social, value: Number(values.value) || 0 });
  };

  return (
    <form onSubmit={submitLead}>
      <h2>{lead ? "Edit lead" : "Add a lead"}</h2>
      <p>Facebook, Instagram and X values are saved to the SQL Server lead record.</p>
      <div className="form-grid">
        <Field label="Full name" name="name" placeholder="Alicia Morgan" required value={values.name} onValueChange={update("name")} />
        <Field
          label="Email"
          name="email"
          type="email"
          placeholder="alicia@company.com"
          required
          value={values.email}
          onValueChange={update("email")}
        />
        <Field label="Phone" name="phone" placeholder="(305) 555-0123" value={values.phone} onValueChange={update("phone")} />
        <Field label="Facebook" name="facebook" placeholder="Profile URL or username" value={values.facebook} onValueChange={update("facebook")} />
        <Field label="Instagram" name="instagram" placeholder="@username or profile URL" value={values.instagram} onValueChange={update("instagram")} />
        <Field label="X" name="x" placeholder="@username or profile URL" value={values.x} onValueChange={update("x")} />
        <Field label="Source" name="source" placeholder="Instagram" value={values.source} onValueChange={update("source")} />
        <Field label="Last Intent" name="lastIntent" placeholder="PURCHASE_INTENT" value={values.lastIntent} onValueChange={update("lastIntent")} />
        <Field
          label="Estimated value"
          name="value"
          type="number"
          placeholder="1200"
          value={values.value}
          onValueChange={update("value")}
        />
        <label className="lead-ai-response-field">
          AI Response
          <textarea
            name="crmnotes"
            placeholder="AI-generated response or CRM follow-up notes"
            maxLength={10000}
            value={values.crmnotes}
            onChange={(event) => update("crmnotes")(event.target.value)}
          />
        </label>
      </div>
      <button className="primary submit" disabled={busy}>
        {busy ? "Saving..." : lead ? "Update lead" : "Save lead"}
      </button>
    </form>
  );
}

type ContentSubmit = (
  event: FormEvent<HTMLFormElement>,
  action: string,
  id?: number | string,
  createdByAi?: boolean,
) => void;

function CampaignForm({
  campaign,
  bufferChannels,
  bufferConnection,
  defaultPublishTime,
  save,
  saveError,
  dismissSaveError,
  busy,
}: {
  campaign: Campaign | null;
  bufferChannels: BufferChannel[];
  bufferConnection: BufferConnection;
  defaultPublishTime: string;
  save: (event: FormEvent<HTMLFormElement>, campaign: Campaign | null, mediaFile: File | null, removeMedia: boolean) => Promise<void>;
  saveError: string;
  dismissSaveError: () => void;
  busy: boolean;
}) {
  const savedChannelIds = (campaign?.targetSocialChannels?.length
    ? campaign.targetSocialChannels.map((channel) => channel.id)
    : campaign?.campaignPosts?.filter((post) => post.isActive !== false).map((post) => post.bufferChannelId)) || [];
  const [postType, setPostType] = useState<"POST" | "REEL" | "STORY">(campaign?.postType || "POST");
  const [campaignStatus, setCampaignStatus] = useState(campaign?.status?.toLowerCase() === "draft" ? "DRAFT" : "PRODUCTION");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(savedChannelIds);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState(campaign?.mediaUrl || "");
  const [mediaRemoved, setMediaRemoved] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [clientVideoMetadata, setClientVideoMetadata] = useState<ClientVideoMetadata | null>(null);
  const [mediaInspectionPending, setMediaInspectionPending] = useState(false);
  const previewObjectUrl = useRef<string | null>(null);

  useEffect(() => () => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
  }, []);

  const formChannels = [
    ...bufferChannels,
    ...(campaign?.targetSocialChannels || [])
      .filter((saved) => !bufferChannels.some((channel) => channel.id === saved.id))
      .map((saved) => ({ ...saved, name: saved.displayName, avatar: null, isQueuePaused: true })),
  ];
  const effectiveMediaType = mediaFile
    ? mediaFile.type.startsWith("video/") ? "video" : "image"
    : mediaRemoved ? null : campaign?.mediaType || null;
  const selectedServices = formChannels
    .filter((channel) => selectedChannels.includes(channel.id))
    .map((channel) => channel.service);
  const clientVideoError = mediaFile?.type.startsWith("video/") && clientVideoMetadata
    ? browserVideoValidationErrors(clientVideoMetadata, {
        postType,
        services: selectedServices,
        sizeBytes: mediaFile.size,
      }).join(" ")
    : "";
  const effectiveMediaError = mediaError || clientVideoError;
  const compatibilityError = postType !== "POST" && selectedServices.some((service) => !["instagram", "facebook"].includes(service))
    ? `${postType} is available only for connected Instagram or Facebook channels.`
    : postType === "POST" && effectiveMediaType === "video" && selectedServices.includes("instagram")
    ? "Instagram no longer accepts a standard video Post through Buffer. Choose Reel or Story."
    : postType === "REEL" && effectiveMediaType !== "video"
    ? "A Reel requires an MP4 or MOV video."
    : postType === "STORY" && !effectiveMediaType
    ? "A Story requires an image or video."
    : clientVideoError
    ? clientVideoError
    : "";

  const selectMedia = (file: File | null) => {
    if (!file) return;
    const allowed = new Map([
      ["image/jpeg", new Set(["jpg", "jpeg"])],
      ["image/png", new Set(["png"])],
      ["image/webp", new Set(["webp"])],
      ["image/gif", new Set(["gif"])],
      ["video/mp4", new Set(["mp4"])],
      ["video/quicktime", new Set(["mov"])],
    ]);
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!allowed.has(file.type) || !allowed.get(file.type)?.has(extension)) {
      setMediaError("Choose a JPEG, PNG, WebP, GIF, MP4, or MOV file.");
      return;
    }
    if (file.size < 1 || file.size > INSTAGRAM_VIDEO_MAX_BYTES) {
      setMediaError("Media must be larger than 0 bytes and no more than 300 MB.");
      return;
    }
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    previewObjectUrl.current = URL.createObjectURL(file);
    setMediaFile(file);
    setMediaPreview(previewObjectUrl.current);
    setMediaRemoved(false);
    setClientVideoMetadata(null);
    setMediaError("");
    if (file.type.startsWith("video/")) {
      const objectUrl = previewObjectUrl.current;
      setMediaInspectionPending(true);
      const probe = document.createElement("video");
      probe.preload = "metadata";
      probe.onloadedmetadata = () => {
        if (previewObjectUrl.current !== objectUrl) return;
        setClientVideoMetadata({
          width: probe.videoWidth,
          height: probe.videoHeight,
          durationSeconds: probe.duration,
        });
        setMediaInspectionPending(false);
      };
      probe.onerror = () => {
        if (previewObjectUrl.current !== objectUrl) return;
        setMediaError("This browser could not read the video metadata. Export the file as MP4 with H.264 video and AAC audio, then try again.");
        setMediaInspectionPending(false);
      };
      probe.src = objectUrl;
    } else {
      setMediaInspectionPending(false);
    }
  };

  const removeMedia = () => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    previewObjectUrl.current = null;
    setMediaFile(null);
    setMediaPreview("");
    setMediaRemoved(true);
    setClientVideoMetadata(null);
    setMediaInspectionPending(false);
    setMediaError("");
  };

  const onMediaChange = (event: ChangeEvent<HTMLInputElement>) => selectMedia(event.target.files?.[0] || null);
  const onMediaDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    selectMedia(event.dataTransfer.files?.[0] || null);
  };

  return (
    <form onSubmit={(event) => void save(event, campaign, mediaFile, mediaRemoved)}>
      <span className="insight-tag">BUFFER · SQL AUTHORITATIVE</span>
      <h2>{campaign ? "Edit campaign" : "Create and schedule a campaign"}</h2>
      <p>{campaign
        ? "Values are loaded from SQL. Eligible scheduled posts are updated through Buffer editPost without creating duplicates."
        : "The CRM saves the campaign and one post row per channel before Buffer receives any publishing request."}</p>
      <Field label="Campaign name" name="campaignName" placeholder="Scale Without Burnout" required defaultValue={campaign?.name} />
      <Field
        label="Campaign objective"
        name="campaignObjective"
        placeholder="Register qualified founders for the webinar"
        required
        defaultValue={campaign?.campaignObjective || campaign?.audience}
      />
      <label>
        Post text <span style={{ color: "#ba3d3d" }}> *</span>
        <textarea
          name="postText"
          placeholder="Join our free webinar to build a business that grows without burning out."
          required
          defaultValue={campaign?.postText || campaign?.message}
        />
      </label>
      <div className="form-grid">
        <label>
          Post type
          <select name="postType" value={postType} onChange={(event) => setPostType(event.target.value as "POST" | "REEL" | "STORY")} required>
            <option value="POST">Post</option>
            <option value="REEL">Reel</option>
            <option value="STORY">Story</option>
          </select>
        </label>
        <label>
          Campaign status
          <select name="campaignStatus" value={campaignStatus} onChange={(event) => setCampaignStatus(event.target.value)}>
            <option value="PRODUCTION">Schedule / synchronize in Buffer</option>
            <option value="DRAFT">Save SQL draft only</option>
          </select>
        </label>
        <Field label="Publish date and time" name="publishDateTime" type="datetime-local" required defaultValue={defaultPublishTime} />
        <Field label="High-intent keywords" name="highIntentKeywords" placeholder="pricing, webinar, demo" defaultValue={campaign?.highIntentKeywords} />
        <label className="checkbox-field">
          <input type="checkbox" name="aiReplyEnabled" value="true" defaultChecked={campaign?.aiReplyEnabled} />
          Enable AI reply handling for this campaign
        </label>
      </div>
      <section className="campaign-media-editor">
        <div>
          <strong>Image or video</strong>
          <small>Buffer requires a stable public URL. Files are validated on the server and binaries are not stored in SQL.</small>
        </div>
        <label
          className={`campaign-media-drop${mediaPreview ? " has-media" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onMediaDrop}
        >
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov" onChange={onMediaChange} />
          {mediaPreview ? (
            effectiveMediaType === "video" ? (
              <video src={mediaPreview} controls muted preload="metadata" />
            ) : (
              <span className="campaign-media-image" role="img" aria-label={mediaFile?.name || campaign?.mediaOriginalName || "Campaign image preview"} style={{ backgroundImage: `url(${mediaPreview})` }} />
            )
          ) : (
            <span><b>Drop media here</b><small>or click to browse · JPEG, PNG, WebP, GIF, MP4, MOV · up to 300 MB</small></span>
          )}
        </label>
        {mediaPreview && (
          <div className="campaign-media-details">
            <span>
              {mediaFile?.name || campaign?.mediaOriginalName || "Saved campaign media"}
              {(mediaFile?.size || campaign?.mediaSizeBytes) ? ` · ${formatFileSize(mediaFile?.size || campaign?.mediaSizeBytes || 0)}` : ""}
              {clientVideoMetadata ? ` · ${clientVideoMetadata.width}×${clientVideoMetadata.height} · ${clientVideoMetadata.durationSeconds.toFixed(1)}s` : ""}
              {mediaInspectionPending ? " · checking video…" : ""}
            </span>
            <button type="button" onClick={removeMedia}>Remove media</button>
          </div>
        )}
        {effectiveMediaError && <small className="form-error">{effectiveMediaError}</small>}
      </section>
      <fieldset className="buffer-channel-picker">
        <legend>Target social channels</legend>
        {formChannels.length ? formChannels.map((channel, index) => (
          <div key={channel.id} className="checkbox-field">
            <input
              id={`buffer-channel-${index}`}
              aria-label={`Select ${channel.displayName}`}
              type="checkbox"
              name="targetSocialChannels"
              value={channel.id}
              disabled={channel.isQueuePaused}
              checked={selectedChannels.includes(channel.id)}
              onChange={(event) => setSelectedChannels((current) => event.target.checked
                ? [...new Set([...current, channel.id])]
                : current.filter((id) => id !== channel.id))}
            />
            {channel.isQueuePaused && selectedChannels.includes(channel.id) && <input type="hidden" name="targetSocialChannels" value={channel.id} />}
            <span>
              <strong>{channel.displayName}</strong>
              <small>{channel.service === "twitter" ? "X" : channel.service}{channel.isQueuePaused ? " · Buffer queue paused" : ""}</small>
            </span>
          </div>
        )) : <small>{bufferConnection.reason}</small>}
      </fieldset>
      {(compatibilityError || !selectedChannels.length) && (
        <small className="form-error">{compatibilityError || "Select at least one Buffer channel."}</small>
      )}
      <div className="buffer-ai-limit">
        <button type="button" disabled>Buffer AI Assist unavailable via public API</button>
        <small>Buffer exposes the aiAssisted tracking flag, but no public content-generation operation. No substitute or fabricated endpoint is used.</small>
      </div>
      {saveError && (
        <div className="campaign-save-error" role="alert" aria-live="assertive">
          <div>
            <strong>Campaign save needs attention</strong>
            <span>{saveError}</span>
          </div>
          <button type="button" onClick={dismissSaveError} aria-label="Dismiss campaign save error">Dismiss</button>
        </div>
      )}
      <div className="buffer-production-note">
        <strong>{campaignStatus === "DRAFT" ? "Campaign remains a SQL draft" : "Campaign status: Draft → Production"}</strong>
        <small>{campaignStatus === "DRAFT"
          ? "No Buffer post is created until you reopen the campaign and choose scheduling."
          : "Production is set only after every selected channel returns a scheduled or synchronized Buffer post."}</small>
      </div>
      <button className="primary submit" disabled={busy || mediaInspectionPending || bufferConnection.status !== "connected" || !selectedChannels.length || Boolean(compatibilityError) || Boolean(effectiveMediaError)}>
        {busy
          ? "Saving campaign..."
          : campaign
          ? campaignStatus === "DRAFT" ? "Save campaign draft" : "Save changes and synchronize Buffer"
          : campaignStatus === "DRAFT" ? "Save SQL draft" : "Save to SQL and schedule in Buffer"}
      </button>
    </form>
  );
}

function PageForm({
  page,
  campaigns,
  submit,
  busy,
}: {
  page: Landing | null;
  campaigns: Campaign[];
  submit: ContentSubmit;
  busy: boolean;
}) {
  return (
    <form onSubmit={(e) => submit(e, page ? "page.update" : "page.create", page?.id, page?.createdByAi)}>
      <h2>{page ? "Edit webinar page" : "Publish a webinar page"}</h2>
      <p>{page ? "Update the page while preserving its lead capture and webinar flow." : "Create the full teaser, registration, webinar and payment path."}</p>
      <div className="form-grid">
        <Field label="Internal title" name="title" placeholder="Founder Growth Webinar" required defaultValue={page?.title} />
        <Field label="Page address" name="slug" placeholder="founder-growth" required defaultValue={page?.slug} />
        <label>
          Campaign
          <select name="campaignId" defaultValue={page?.campaignId ? String(page.campaignId) : ""}>
            <option value="">No campaign</option>
            {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={page?.status || "published"}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>
      <Field
        label="Headline"
        name="headline"
        placeholder="Scale your company without burning out"
        required
        defaultValue={page?.headline}
      />
      <label>
        Teaser message
        <textarea
          name="teaser"
          placeholder="Watch this 60-second preview to see what you will learn."
          defaultValue={page?.teaser}
        />
      </label>
      <div className="form-grid">
        <Field
          label="Webinar video URL"
          name="webinarUrl"
          type="url"
          placeholder="https://..."
          defaultValue={page?.webinarUrl}
        />
        <Field
          label="Payment URL"
          name="paymentUrl"
          type="url"
          placeholder="https://buy.stripe.com/..."
          defaultValue={page?.paymentUrl}
        />
      </div>
      <button className="primary submit" disabled={busy}>
        {busy ? "Saving..." : page ? "Save page changes" : "Publish page"}
      </button>
    </form>
  );
}

function datetimeLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatFileSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function WebinarForm({
  webinar,
  submit,
  busy,
  campaigns,
  pages,
}: {
  webinar: WebinarRecord | null;
  submit: ContentSubmit;
  busy: boolean;
  campaigns: Campaign[];
  pages: Landing[];
}) {
  return (
    <form onSubmit={(event) => submit(event, webinar ? "webinar.update" : "webinar.create", webinar?.id, webinar?.createdByAi)}>
      <h2>{webinar ? "Edit webinar" : "Create a webinar"}</h2>
      <p>{webinar ? "Update the webinar and its existing campaign and landing-page relationships." : "The webinar record and its relationships are stored in SQL Server."}</p>
      <Field label="Title" name="title" placeholder="Founder Growth Webinar" required defaultValue={webinar?.title} />
      <label>Description<textarea name="description" placeholder="What attendees will learn" defaultValue={webinar?.description} /></label>
      <div className="form-grid">
        <Field label="Scheduled time" name="scheduledAt" type="datetime-local" defaultValue={datetimeLocalValue(webinar?.scheduledAt)} />
        <Field label="Webinar URL" name="webinarUrl" type="url" placeholder="https://..." defaultValue={webinar?.webinarUrl} />
        <label>Campaign<select name="campaignId" defaultValue={webinar?.campaignId ? String(webinar.campaignId) : ""}><option value="">No campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
        <label>Landing page<select name="landingPageId" defaultValue={webinar?.landingPageId ? String(webinar.landingPageId) : ""}><option value="">No landing page</option>{pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={webinar?.status || "draft"}><option value="draft">Draft</option><option value="published">Published</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
      </div>
      <button className="primary submit" disabled={busy}>{busy ? "Saving..." : webinar ? "Save webinar changes" : "Save webinar draft"}</button>
    </form>
  );
}

function AiDraftForm({
  busy,
  setBusy,
  onSaved,
}: {
  busy: boolean;
  setBusy: (value: boolean) => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("The generated record will be validated, saved to SQL as a draft, and left for human review.");
  const submitAi = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("Generating a structured draft...");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/social/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json() as { message?: string; error?: string; record?: { id?: string } };
      if (!response.ok) throw new Error(result.error || result.message || "AI generation failed.");
      await onSaved(`${result.message || "AI draft saved."}${result.record?.id ? ` ID: ${result.record.id}` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI generation failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submitAi}>
      <span className="insight-tag">AI STRUCTURED DRAFT</span>
      <h2>Create with AI</h2>
      <p>{message}</p>
      <label>Record type<select name="entity" defaultValue="campaign"><option value="campaign">Campaign</option><option value="landing_page">Landing page</option><option value="webinar">Webinar</option></select></label>
      <label>Brief<textarea name="brief" placeholder="Describe the offer, audience, tone, call to action, and required details." required /></label>
      <button className="primary submit" disabled={busy}>{busy ? "Generating & saving..." : "Generate validated SQL draft"}</button>
    </form>
  );
}
