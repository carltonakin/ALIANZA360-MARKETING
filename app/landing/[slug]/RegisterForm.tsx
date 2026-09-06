"use client";

import { FormEvent, useRef, useState } from "react";

const DEFAULT_SUBMIT_TEXT = "Register Now for an Interview";

export function RegisterForm({
  pageId,
  paymentUrl,
  submitButtonText,
}: {
  pageId: string;
  paymentUrl: string;
  submitButtonText?: string;
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
      registrationId.current ||= typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data, pageId, registrationId: registrationId.current }),
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
      <span className="lp-eyebrow">FREE ON-DEMAND WEBINAR</span>
      <h2>Get instant access</h2>
      <p>Tell us where to send your resources. The webinar will start immediately.</p>
      <input name="name" placeholder="Full name" maxLength={255} required />
      <input name="email" type="email" placeholder="Email address" maxLength={320} required />
      <input name="phone" type="tel" placeholder="Phone number" maxLength={80} />
      <input name="instagram" placeholder="Instagram handle (optional)" maxLength={255} autoComplete="off" />
      <input name="facebook" placeholder="Facebook handle (optional)" maxLength={255} autoComplete="off" />
      <input name="x" placeholder="X handle (optional)" maxLength={255} autoComplete="off" />
      {error && <small className="form-error" role="alert">{error}</small>}
      <button className="lp-button" disabled={busy}>{busy ? "Registering..." : submitButtonText?.trim() || DEFAULT_SUBMIT_TEXT}</button>
      <small>Your information is securely added to our CRM.</small>
    </form>
  );
}
