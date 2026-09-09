"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { LandingVideoPlayer } from "./LandingVideoPlayer";
import { RegisterForm } from "../landing/[slug]/RegisterForm";

export type LandingPageBlock = {
  id: string;
  type: string;
  sortOrder: number;
  enabled: boolean;
  config: Record<string, unknown>;
};

const value = (input: unknown) => typeof input === "string" ? input : "";
const items = (input: unknown) => Array.isArray(input) ? input as Array<Record<string, unknown>> : [];

function Countdown({ targetAt, expiredText }: { targetAt: string; expiredText: string }) {
  const [label, setLabel] = useState("--d --h --m --s");
  useEffect(() => {
    const update = () => {
      const remaining = new Date(targetAt).getTime() - Date.now();
      if (!targetAt || !Number.isFinite(remaining) || remaining <= 0) return setLabel(expiredText || "Registration is now closed.");
      const days = Math.floor(remaining / 86_400_000);
      const hours = Math.floor(remaining / 3_600_000) % 24;
      const minutes = Math.floor(remaining / 60_000) % 60;
      const seconds = Math.floor(remaining / 1000) % 60;
      setLabel(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiredText, targetAt]);
  return <strong className="lp-countdown-clock">{label}</strong>;
}

function PreviewForm({ config }: { config: Record<string, unknown> }) {
  const fields = (config.fields || {}) as Record<string, { enabled?: boolean; required?: boolean; label?: string }>;
  return (
    <div className="register-card lp-preview-form">
      <span className="lp-eyebrow">{value(config.eyebrow)}</span>
      <h2>{value(config.heading)}</h2>
      <p>{value(config.body)}</p>
      {["name", "email", "phone", "instagram", "facebook", "x", "message"].map((field) => {
        const definition = fields[field];
        if (definition?.enabled === false || (field === "message" && !definition?.enabled)) return null;
        return <div className="lp-preview-input" key={field}>{definition?.label || field}{definition?.required ? " *" : ""}</div>;
      })}
      <button className="lp-button" type="button">{value(config.submitButtonText) || "Register now"}</button>
    </div>
  );
}

export function LandingPageBlocks({
  blocks,
  pageId,
  paymentUrl = "",
  preview = false,
}: {
  blocks: LandingPageBlock[];
  pageId: string;
  paymentUrl?: string;
  preview?: boolean;
}) {
  return (
    <div className="lp-blocks">
      {blocks.filter((block) => block.enabled).sort((a, b) => a.sortOrder - b.sortOrder).map((block) => {
        const config = block.config || {};
        const alignment = value(config.alignment) || "left";
        if (block.type === "HERO") return (
          <section className={`lp-block lp-block-hero${config.backgroundUrl ? " has-background" : ""}`} key={block.id} style={config.backgroundUrl ? { backgroundImage: `linear-gradient(#18182799,#18182799),url(${value(config.backgroundUrl)})` } : undefined}>
            <div style={{ textAlign: alignment as "left" | "center" | "right" }}>
              {Boolean(config.eyebrow) && <span className="lp-eyebrow">{value(config.eyebrow)}</span>}
              <h1>{value(config.headline)}</h1>
              {Boolean(config.body) && <p>{value(config.body)}</p>}
            </div>
          </section>
        );
        if (block.type === "TEXT") return (
          <section className="lp-block lp-block-text" key={block.id} style={{ textAlign: alignment as "left" | "center" | "right" }}>
            {Boolean(config.heading) && <h2>{value(config.heading)}</h2>}
            <p>{value(config.body)}</p>
          </section>
        );
        if (block.type === "IMAGE") return value(config.url) ? (
          <figure className="lp-block landing-picture" key={block.id}>
            <Image src={value(config.url)} alt={value(config.alt) || "Landing page image"} width={1600} height={900} sizes="(max-width: 760px) 100vw, 900px" unoptimized={value(config.url).startsWith("blob:")} />
            {Boolean(config.caption) && <figcaption>{value(config.caption)}</figcaption>}
          </figure>
        ) : preview ? <div className="lp-block lp-empty-media" key={block.id}>Add an image</div> : null;
        if (block.type === "VIDEO") return value(config.videoUrl) ? (
          <section className="lp-block" key={block.id}>
            <LandingVideoPlayer
              sourceType={config.videoSourceType as "NONE" | "UPLOAD" | "EXTERNAL_URL"}
              videoUrl={value(config.videoUrl)}
              provider={config.videoProvider as "CLOUDINARY" | "YOUTUBE" | "VIMEO" | "CANVA" | null}
              autoplay={config.autoplay !== false}
              muted={config.muted !== false}
              showControls={config.showControls !== false}
            />
          </section>
        ) : preview ? <div className="lp-block lp-empty-media" key={block.id}>Add a video</div> : null;
        if (block.type === "CTA_BUTTON") {
          if (!preview && !value(config.url)) return null;
          return (
          <section className="lp-block lp-block-cta" key={block.id} style={{ textAlign: alignment as "left" | "center" | "right" }}>
            {preview
              ? <button className={`lp-button ${config.style === "secondary" ? "lp-button-secondary" : ""}`} type="button">{value(config.text) || "Call to action"}</button>
              : <a className={`lp-button ${config.style === "secondary" ? "lp-button-secondary" : ""}`} href={value(config.url)} target={config.openInNewTab ? "_blank" : undefined} rel={config.openInNewTab ? "noreferrer" : undefined}>{value(config.text) || "Call to action"}</a>}
          </section>
          );
        }
        if (block.type === "REGISTRATION_FORM") return (
          <section className="lp-block" key={block.id}>
            {preview ? <PreviewForm config={config} /> : <RegisterForm pageId={pageId} paymentUrl={paymentUrl} submitButtonText={value(config.submitButtonText)} fields={config.fields as Record<string, { enabled?: boolean; required?: boolean; label?: string }>} eyebrow={value(config.eyebrow)} heading={value(config.heading)} body={value(config.body)} />}
          </section>
        );
        if (block.type === "SOCIAL_HANDLES") {
          const links = [["Instagram", config.instagram], ["Facebook", config.facebook], ["X", config.x], ["LinkedIn", config.linkedin]].filter(([, url]) => Boolean(url));
          return <section className="lp-block lp-block-social" key={block.id}><h2>{value(config.heading)}</h2><div>{links.map(([name, url]) => preview ? <button type="button" key={value(name)}>{value(name)}</button> : <a href={value(url)} key={value(name)}>{value(name)}</a>)}</div></section>;
        }
        if (block.type === "TESTIMONIALS") return (
          <section className="lp-block lp-block-testimonials" key={block.id}><h2>{value(config.heading)}</h2><div>{items(config.items).map((item, index) => <blockquote key={index}><p>“{value(item.quote)}”</p><footer><strong>{value(item.name)}</strong>{value(item.role) && <span>{value(item.role)}</span>}</footer></blockquote>)}</div></section>
        );
        if (block.type === "FAQ") return (
          <section className="lp-block lp-block-faq" key={block.id}><h2>{value(config.heading)}</h2>{items(config.items).map((item, index) => <details key={index}><summary>{value(item.question)}</summary><p>{value(item.answer)}</p></details>)}</section>
        );
        if (block.type === "COUNTDOWN") return (
          <section className="lp-block lp-block-countdown" key={block.id}><h2>{value(config.heading)}</h2><Countdown targetAt={value(config.targetAt)} expiredText={value(config.expiredText)} /></section>
        );
        if (block.type === "DIVIDER") return <hr className={`lp-block lp-divider lp-divider-${value(config.spacing) || "medium"}`} key={block.id} />;
        if (block.type === "PAYMENT_CTA") {
          const destination = value(config.url) || paymentUrl;
          return (
            <section className="lp-block lp-block-payment" key={block.id} style={{ textAlign: alignment as "left" | "center" | "right" }}><h2>{value(config.heading)}</h2><p>{value(config.body)}</p>{preview ? <button className="lp-button" type="button">{value(config.text) || "Continue"}</button> : destination ? <a className="lp-button" href={destination}>{value(config.text) || "Continue"}</a> : null}</section>
          );
        }
        return null;
      })}
    </div>
  );
}
