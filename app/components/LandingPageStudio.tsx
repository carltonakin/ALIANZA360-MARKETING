"use client";

import { type ChangeEvent, type DragEvent, useMemo, useRef, useState } from "react";
import {
  defaultLandingPageBlock,
  LANDING_PAGE_BLOCK_TYPES,
  resolveLandingPageBlocks,
} from "../../lib/landing-page-studio.mjs";
import { normalizeExternalVideoUrl } from "../../lib/landing-page-video.mjs";
import { LandingPageBlocks, type LandingPageBlock } from "./LandingPageBlocks";

type StudioPage = {
  id: number | string;
  campaignId?: number | string | null;
  title: string;
  slug: string;
  status: string;
  paymentUrl?: string;
  blocks?: LandingPageBlock[];
  [key: string]: unknown;
};

type Upload = {
  mediaType: "image" | "video";
  mediaUrl: string;
  assetId: string;
  publicId: string;
  resourceType: "image" | "video";
};

const BLOCK_LABELS: Record<string, string> = {
  HERO: "Hero",
  TEXT: "Text",
  IMAGE: "Image",
  VIDEO: "Video",
  CTA_BUTTON: "CTA button",
  REGISTRATION_FORM: "Registration form",
  SOCIAL_HANDLES: "Social handles",
  TESTIMONIALS: "Testimonials",
  FAQ: "FAQ",
  COUNTDOWN: "Countdown",
  DIVIDER: "Divider",
  PAYMENT_CTA: "Payment CTA",
};

const stringValue = (value: unknown) => typeof value === "string" ? value : "";

function uniqueBlock(type: string) {
  const key = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return defaultLandingPageBlock(type, `block-${key}`) as LandingPageBlock;
}

function Field({ label, value, onChange, type = "text", placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label>{label}<input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function AlignField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label>Alignment<select value={value || "left"} onChange={(event) => onChange(event.target.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>;
}

export function LandingPageStudio({
  page,
  campaigns,
  busy,
  onSaved,
}: {
  page: StudioPage | null;
  campaigns: Array<{ id: number | string; name: string }>;
  busy: boolean;
  onSaved: (message: string) => Promise<void>;
}) {
  const fallback = useMemo(() => ({
    title: "",
    slug: "",
    headline: "A clear path to your next level",
    teaser: "Show visitors the outcome they can expect.",
    body: "Show visitors the outcome they can expect.",
  }), []);
  const initialBlocks = useMemo(() => page
    ? resolveLandingPageBlocks(page) as LandingPageBlock[]
    : [
        defaultLandingPageBlock("HERO", "new-hero"),
        defaultLandingPageBlock("TEXT", "new-text"),
        defaultLandingPageBlock("REGISTRATION_FORM", "new-registration"),
      ].map((block, index) => ({ ...block, sortOrder: index })) as LandingPageBlock[], [page]);
  const [title, setTitle] = useState(page?.title || "");
  const [slug, setSlug] = useState(page?.slug || "");
  const [campaignId, setCampaignId] = useState(page?.campaignId ? String(page.campaignId) : "");
  const [status, setStatus] = useState(page?.status || "draft");
  const [blocks, setBlocks] = useState<LandingPageBlock[]>(initialBlocks);
  const [selectedId, setSelectedId] = useState(initialBlocks[0]?.id || "");
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [pendingFiles, setPendingFiles] = useState<Record<string, File>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const draggedId = useRef("");
  const selected = blocks.find((block) => block.id === selectedId) || null;

  const updateBlock = (id: string, change: Partial<LandingPageBlock>) => setBlocks((current) => current.map((block) => block.id === id ? { ...block, ...change } : block));
  const updateConfig = (key: string, value: unknown) => {
    if (!selected) return;
    updateBlock(selected.id, { config: { ...selected.config, [key]: value } });
  };
  const ordered = (next: LandingPageBlock[]) => next.map((block, sortOrder) => ({ ...block, sortOrder }));
  const move = (id: string, offset: number) => setBlocks((current) => {
    const from = current.findIndex((block) => block.id === id);
    const to = Math.max(0, Math.min(current.length - 1, from + offset));
    if (from < 0 || from === to) return current;
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return ordered(next);
  });
  const remove = (id: string) => setBlocks((current) => {
    const next = ordered(current.filter((block) => block.id !== id));
    if (selectedId === id) setSelectedId(next[0]?.id || "");
    return next;
  });
  const add = (type: string) => {
    const block = { ...uniqueBlock(type), sortOrder: blocks.length };
    setBlocks((current) => [...current, block]);
    setSelectedId(block.id);
  };
  const drop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    const sourceId = draggedId.current;
    if (!sourceId || sourceId === targetId) return;
    setBlocks((current) => {
      const next = [...current];
      const from = next.findIndex((block) => block.id === sourceId);
      const to = next.findIndex((block) => block.id === targetId);
      if (from < 0 || to < 0) return current;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return ordered(next);
    });
  };
  const chooseFile = (event: ChangeEvent<HTMLInputElement>, slot: "media" | "background") => {
    if (!selected) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const key = `${selected.id}:${slot}`;
    if (previews[key]) URL.revokeObjectURL(previews[key]);
    setPendingFiles((current) => ({ ...current, [key]: file }));
    setPreviews((current) => ({ ...current, [key]: URL.createObjectURL(file) }));
    setMessage(`${file.name} is ready to upload when you save.`);
  };

  const previewBlocks = blocks.map((block) => {
    const mediaPreview = previews[`${block.id}:media`];
    const backgroundPreview = previews[`${block.id}:background`];
    if (!mediaPreview && !backgroundPreview) return block;
    return {
      ...block,
      config: {
        ...block.config,
        ...(mediaPreview ? block.type === "VIDEO" ? { videoUrl: mediaPreview, videoProvider: "CLOUDINARY", videoSourceType: "UPLOAD", autoplay: false } : { url: mediaPreview } : {}),
        ...(backgroundPreview ? { backgroundUrl: backgroundPreview } : {}),
      },
    };
  });

  async function save() {
    if (!title.trim() || !slug.trim()) return setMessage("Add an internal title and page address before saving.");
    setSaving(true);
    setMessage("Saving landing-page design…");
    const uploaded: Upload[] = [];
    try {
      let nextBlocks = structuredClone(blocks);
      for (const [key, file] of Object.entries(pendingFiles)) {
        const [blockId, slot] = key.split(":");
        const form = new FormData();
        form.append("media", file);
        form.append("purpose", file.type.startsWith("video/") ? "landing_page_video" : "landing_page_picture");
        const response = await fetch("/api/media", { method: "POST", body: form });
        const body = await response.json().catch(() => ({})) as { media?: Upload; error?: string };
        if (!response.ok || !body.media) throw new Error(body.error || `Could not upload ${file.name}.`);
        uploaded.push(body.media);
        nextBlocks = nextBlocks.map((block) => {
          if (block.id !== blockId) return block;
          const identity = { cloudinaryAssetId: body.media?.assetId, cloudinaryPublicId: body.media?.publicId, cloudinaryResourceType: body.media?.resourceType };
          return { ...block, config: slot === "background"
            ? { ...block.config, backgroundUrl: body.media?.mediaUrl, backgroundCloudinaryAssetId: body.media?.assetId, backgroundCloudinaryPublicId: body.media?.publicId, backgroundCloudinaryResourceType: "image" }
            : block.type === "VIDEO"
              ? { ...block.config, videoSourceType: "UPLOAD", videoUrl: body.media?.mediaUrl, videoProvider: "CLOUDINARY", ...identity }
              : { ...block.config, url: body.media?.mediaUrl, ...identity } };
        });
      }
      const hero = nextBlocks.find((block) => block.type === "HERO")?.config || fallback;
      const response = await fetch("/api/social/content", {
        method: page ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity: "landing_page",
          ...(page ? { id: page.id } : {}),
          campaignId: campaignId || null,
          title: title.trim(),
          slug: slug.trim(),
          headline: stringValue(hero.headline) || fallback.headline,
          teaser: stringValue(hero.body) || fallback.teaser,
          status,
          createdByAi: Boolean(page?.createdByAi),
          blocks: ordered(nextBlocks),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error || body.message || "The landing page could not be saved.");
      await onSaved(page ? "Landing-page design saved" : "Landing page created");
    } catch (error) {
      for (const item of uploaded) {
        await fetch(`/api/media/${encodeURIComponent(item.assetId)}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicId: item.publicId, resourceType: item.resourceType }),
        }).catch(() => undefined);
      }
      setMessage(error instanceof Error ? error.message : "The landing page could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const itemList = (key: "items", kind: "testimonial" | "faq") => {
    const current = Array.isArray(selected?.config[key]) ? selected.config[key] as Array<Record<string, unknown>> : [];
    const updateItem = (index: number, field: string, nextValue: string) => updateConfig(key, current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: nextValue } : item));
    return <div className="studio-repeat-list">{current.map((item, index) => <div key={index} className="studio-repeat-item">
      <Field label={kind === "faq" ? "Question" : "Quote"} value={stringValue(item[kind === "faq" ? "question" : "quote"])} onChange={(next) => updateItem(index, kind === "faq" ? "question" : "quote", next)} />
      <Field label={kind === "faq" ? "Answer" : "Name"} value={stringValue(item[kind === "faq" ? "answer" : "name"])} onChange={(next) => updateItem(index, kind === "faq" ? "answer" : "name", next)} />
      {kind === "testimonial" && <Field label="Role" value={stringValue(item.role)} onChange={(next) => updateItem(index, "role", next)} />}
      <button type="button" onClick={() => updateConfig(key, current.filter((_, itemIndex) => itemIndex !== index))}>Remove item</button>
    </div>)}<button type="button" onClick={() => updateConfig(key, [...current, kind === "faq" ? { question: "", answer: "" } : { quote: "", name: "", role: "" }])}>+ Add item</button></div>;
  };

  const settings = selected ? <>
    <div className="studio-settings-head"><div><small>SELECTED BLOCK</small><strong>{BLOCK_LABELS[selected.type]}</strong></div><button type="button" onClick={() => remove(selected.id)}>Remove</button></div>
    <label className="studio-check"><input type="checkbox" checked={selected.enabled} onChange={(event) => updateBlock(selected.id, { enabled: event.target.checked })} />Show this block</label>
    {selected.type === "HERO" && <><Field label="Eyebrow" value={stringValue(selected.config.eyebrow)} onChange={(next) => updateConfig("eyebrow", next)} /><Field label="Headline" value={stringValue(selected.config.headline)} onChange={(next) => updateConfig("headline", next)} /><label>Body<textarea value={stringValue(selected.config.body)} onChange={(event) => updateConfig("body", event.target.value)} /></label><AlignField value={stringValue(selected.config.alignment)} onChange={(next) => updateConfig("alignment", next)} /><label>Background image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => chooseFile(event, "background")} /></label></>}
    {selected.type === "TEXT" && <><Field label="Heading" value={stringValue(selected.config.heading)} onChange={(next) => updateConfig("heading", next)} /><label>Body<textarea value={stringValue(selected.config.body)} onChange={(event) => updateConfig("body", event.target.value)} /></label><AlignField value={stringValue(selected.config.alignment)} onChange={(next) => updateConfig("alignment", next)} /></>}
    {selected.type === "IMAGE" && <><label>Image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => chooseFile(event, "media")} /></label><Field label="Alt text" value={stringValue(selected.config.alt)} onChange={(next) => updateConfig("alt", next)} /><Field label="Caption" value={stringValue(selected.config.caption)} onChange={(next) => updateConfig("caption", next)} /></>}
    {selected.type === "VIDEO" && <><label>Source<select value={stringValue(selected.config.videoSourceType) || "NONE"} onChange={(event) => updateConfig("videoSourceType", event.target.value)}><option value="NONE">None</option><option value="UPLOAD">Cloudinary upload</option><option value="EXTERNAL_URL">YouTube, Vimeo, or Canva</option></select></label>{selected.config.videoSourceType === "UPLOAD" && <label>Video file<input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(event) => chooseFile(event, "media")} /></label>}{selected.config.videoSourceType === "EXTERNAL_URL" && <Field label="Video URL" type="url" value={stringValue(selected.config.videoUrl)} onChange={(next) => { updateConfig("videoUrl", next); try { const normalized = normalizeExternalVideoUrl(next); updateBlock(selected.id, { config: { ...selected.config, videoSourceType: "EXTERNAL_URL", videoUrl: normalized.url, videoProvider: normalized.provider } }); } catch { /* validated when saved */ } }} />}<label className="studio-check"><input type="checkbox" checked={selected.config.autoplay !== false} onChange={(event) => updateConfig("autoplay", event.target.checked)} />Autoplay</label><label className="studio-check"><input type="checkbox" checked={selected.config.muted !== false} onChange={(event) => updateConfig("muted", event.target.checked)} />Muted</label><label className="studio-check"><input type="checkbox" checked={selected.config.showControls !== false} onChange={(event) => updateConfig("showControls", event.target.checked)} />Show controls</label></>}
    {selected.type === "CTA_BUTTON" && <><Field label="Button text" value={stringValue(selected.config.text)} onChange={(next) => updateConfig("text", next)} /><Field label="Destination URL" type="url" value={stringValue(selected.config.url)} onChange={(next) => updateConfig("url", next)} /><label>Style<select value={stringValue(selected.config.style)} onChange={(event) => updateConfig("style", event.target.value)}><option value="primary">Primary</option><option value="secondary">Secondary</option></select></label><AlignField value={stringValue(selected.config.alignment)} onChange={(next) => updateConfig("alignment", next)} /><label className="studio-check"><input type="checkbox" checked={Boolean(selected.config.openInNewTab)} onChange={(event) => updateConfig("openInNewTab", event.target.checked)} />Open in new tab</label></>}
    {selected.type === "REGISTRATION_FORM" && <><Field label="Eyebrow" value={stringValue(selected.config.eyebrow)} onChange={(next) => updateConfig("eyebrow", next)} /><Field label="Heading" value={stringValue(selected.config.heading)} onChange={(next) => updateConfig("heading", next)} /><label>Body<textarea value={stringValue(selected.config.body)} onChange={(event) => updateConfig("body", event.target.value)} /></label><Field label="Submit button" value={stringValue(selected.config.submitButtonText)} onChange={(next) => updateConfig("submitButtonText", next)} /><Field label="Post-registration URL" type="url" value={stringValue(selected.config.postSubmitUrl)} onChange={(next) => updateConfig("postSubmitUrl", next)} /><div className="studio-fields"><strong>CRM fields</strong>{["name", "email", "phone", "instagram", "facebook", "x", "message"].map((field) => { const fields = selected.config.fields as Record<string, { enabled?: boolean; required?: boolean; label?: string }>; const definition = fields?.[field] || {}; const locked = field === "name" || field === "email"; const updateField = (next: Partial<typeof definition>) => updateConfig("fields", { ...fields, [field]: { ...definition, ...next } }); return <div key={field}><label className="studio-check"><input type="checkbox" checked={locked || definition.enabled !== false} disabled={locked} onChange={(event) => updateField({ enabled: event.target.checked })} />{field}</label><label className="studio-check"><input type="checkbox" checked={locked || Boolean(definition.required)} disabled={locked || definition.enabled === false} onChange={(event) => updateField({ required: event.target.checked })} />required</label><input aria-label={`${field} label`} value={definition.label || ""} onChange={(event) => updateField({ label: event.target.value })} /></div>; })}</div></>}
    {selected.type === "SOCIAL_HANDLES" && <><Field label="Heading" value={stringValue(selected.config.heading)} onChange={(next) => updateConfig("heading", next)} />{["instagram", "facebook", "x", "linkedin"].map((network) => <Field key={network} label={`${network} URL`} type="url" value={stringValue(selected.config[network])} onChange={(next) => updateConfig(network, next)} />)}</>}
    {selected.type === "TESTIMONIALS" && <><Field label="Heading" value={stringValue(selected.config.heading)} onChange={(next) => updateConfig("heading", next)} />{itemList("items", "testimonial")}</>}
    {selected.type === "FAQ" && <><Field label="Heading" value={stringValue(selected.config.heading)} onChange={(next) => updateConfig("heading", next)} />{itemList("items", "faq")}</>}
    {selected.type === "COUNTDOWN" && <><Field label="Heading" value={stringValue(selected.config.heading)} onChange={(next) => updateConfig("heading", next)} /><Field label="Target date" type="datetime-local" value={stringValue(selected.config.targetAt).slice(0, 16)} onChange={(next) => updateConfig("targetAt", next)} /><Field label="Expired text" value={stringValue(selected.config.expiredText)} onChange={(next) => updateConfig("expiredText", next)} /></>}
    {selected.type === "DIVIDER" && <label>Spacing<select value={stringValue(selected.config.spacing)} onChange={(event) => updateConfig("spacing", event.target.value)}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>}
    {selected.type === "PAYMENT_CTA" && <><Field label="Heading" value={stringValue(selected.config.heading)} onChange={(next) => updateConfig("heading", next)} /><label>Body<textarea value={stringValue(selected.config.body)} onChange={(event) => updateConfig("body", event.target.value)} /></label><Field label="Button text" value={stringValue(selected.config.text)} onChange={(next) => updateConfig("text", next)} /><Field label="Payment URL" type="url" value={stringValue(selected.config.url)} onChange={(next) => updateConfig("url", next)} /><AlignField value={stringValue(selected.config.alignment)} onChange={(next) => updateConfig("alignment", next)} /></>}
  </> : <p>Select a block to edit it.</p>;

  return (
    <div className="landing-studio">
      <header className="studio-header">
        <div><span className="lp-eyebrow">LANDING PAGE STUDIO</span><h2>{page ? "Edit design" : "Create a landing page"}</h2></div>
        <div className="studio-page-meta"><Field label="Internal title" value={title} onChange={setTitle} placeholder="Founder Growth Webinar" /><Field label="Page address" value={slug} onChange={(next) => setSlug(next.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="founder-growth" /><label>Campaign<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">No campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="draft">Draft</option><option value="published">Published</option>{!["draft", "published"].includes(status) && <option value={status}>{status}</option>}</select></label></div>
        <button className="primary" type="button" disabled={busy || saving} onClick={() => void save()}>{saving ? "Saving…" : status === "published" ? "Save & publish" : "Save draft"}</button>
      </header>
      {message && <div className={/could not|required|invalid|add an/i.test(message) ? "studio-message error" : "studio-message"}>{message}</div>}
      <div className="studio-workspace">
        <aside className="studio-palette"><h3>Available blocks</h3><p>Add reusable sections to the page.</p>{LANDING_PAGE_BLOCK_TYPES.map((type) => <button type="button" key={type} onClick={() => add(type)}><span>+</span>{BLOCK_LABELS[type]}</button>)}</aside>
        <section className="studio-canvas">
          <div className="studio-canvas-toolbar"><div><button className={viewport === "desktop" ? "active" : ""} type="button" onClick={() => setViewport("desktop")}>Desktop</button><button className={viewport === "tablet" ? "active" : ""} type="button" onClick={() => setViewport("tablet")}>Tablet</button><button className={viewport === "mobile" ? "active" : ""} type="button" onClick={() => setViewport("mobile")}>Mobile</button></div><small>Drag blocks to reorder</small></div>
          <div className="studio-block-order">{blocks.map((block, index) => <div role="button" tabIndex={0} draggable key={block.id} className={`studio-order-item${selectedId === block.id ? " selected" : ""}`} onClick={() => setSelectedId(block.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(block.id); }} onDragStart={() => { draggedId.current = block.id; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, block.id)}><span className="studio-drag">⋮⋮</span><strong>{index + 1}. {BLOCK_LABELS[block.type]}</strong><span>{block.enabled ? "Visible" : "Hidden"}</span><i><button type="button" aria-label={`Move ${BLOCK_LABELS[block.type]} up`} onClick={(event) => { event.stopPropagation(); move(block.id, -1); }}>↑</button><button type="button" aria-label={`Move ${BLOCK_LABELS[block.type]} down`} onClick={(event) => { event.stopPropagation(); move(block.id, 1); }}>↓</button></i></div>)}</div>
          <div className={`studio-preview studio-preview-${viewport}`}><div><LandingPageBlocks blocks={previewBlocks} pageId={String(page?.id || "preview")} paymentUrl={page?.paymentUrl || ""} preview /></div></div>
        </section>
        <aside className="studio-settings"><h3>Block settings</h3>{settings}</aside>
      </div>
    </div>
  );
}
