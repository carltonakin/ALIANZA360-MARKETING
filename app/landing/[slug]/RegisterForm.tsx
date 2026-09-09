"use client";

import { FormEvent, useRef, useState } from "react";

const DEFAULT_SUBMIT_TEXT = "Register Now for an Interview";

export function RegisterForm({
  pageId,
  paymentUrl,
  submitButtonText,
  fields,
  eyebrow = "FREE ON-DEMAND WEBINAR",
  heading = "Get instant access",
  body = "Tell us where to send your resources. The webinar will start immediately.",
}: {
  pageId: string;
  paymentUrl: string;
  submitButtonText?: string;
  fields?: Record<string, { enabled?: boolean; required?: boolean; label?: string }>;
  eyebrow?: string;
  heading?: string;
  body?: string;
}) {
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const registrationId = useRef<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const query = new URLSearchParams(window.location.search);
      registrationId.current ||= typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...data,
          pageId,
          registrationId: registrationId.current,
          utmSource: query.get("utm_source") || "",
          utmCampaign: query.get("utm_campaign") || "",
        }),
      });
      const result = await response.json() as { error?: string; redirectUrl?: string | null };
      if (!response.ok) throw new Error(result.error || "Registration failed");
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      setRegistered(true);
    } catch (registrationError) {
      setError(registrationError instanceof Error ? registrationError.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (registered) {
    return (
      <div className="watch-card">
        <span className="lp-eyebrow">YOU’RE REGISTERED</span>
        <h2>Registration complete</h2>
        <p>Thanks—your information has been securely added to our CRM.</p>
        {paymentUrl && <a className="lp-button" href={paymentUrl}>Choose your subscription →</a>}
      </div>
    );
  }

  return (
    <form className="register-card" onSubmit={submit}>
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2>{heading}</h2>
      <p>{body}</p>
      <input name="name" placeholder={fields?.name?.label || "Full name"} maxLength={255} required />
      <input name="email" type="email" placeholder={fields?.email?.label || "Email address"} maxLength={320} required />
      {fields?.phone?.enabled !== false && <input name="phone" type="tel" placeholder={fields?.phone?.label || "Phone number"} maxLength={80} required={fields?.phone?.required} />}
      {fields?.instagram?.enabled !== false && <input name="instagram" placeholder={fields?.instagram?.label || "Instagram handle (optional)"} maxLength={255} autoComplete="off" required={fields?.instagram?.required} />}
      {fields?.facebook?.enabled !== false && <input name="facebook" placeholder={fields?.facebook?.label || "Facebook handle (optional)"} maxLength={255} autoComplete="off" required={fields?.facebook?.required} />}
      {fields?.x?.enabled !== false && <input name="x" placeholder={fields?.x?.label || "X handle (optional)"} maxLength={255} autoComplete="off" required={fields?.x?.required} />}
      {fields?.message?.enabled && <textarea name="message" placeholder={fields.message.label || "How can we help?"} maxLength={2000} required={fields.message.required} />}
      {error && <small className="form-error" role="alert">{error}</small>}
      <button className="lp-button" disabled={busy}>{busy ? "Registering..." : submitButtonText?.trim() || DEFAULT_SUBMIT_TEXT}</button>
      <small>Your information is securely added to our CRM.</small>
    </form>
  );
}
