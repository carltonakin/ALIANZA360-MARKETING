"use client";

import { FormEvent, useState } from "react";

const DEFAULT_SUBMIT_TEXT = "Register Now for an Interview";

export function RegisterForm({
  pageId,
  webinarUrl,
  paymentUrl,
  submitButtonText,
}: {
  pageId: string;
  webinarUrl: string;
  paymentUrl: string;
  submitButtonText?: string;
}) {
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data, pageId }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Registration failed");
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
        <h2>Your webinar starts now</h2>
        {webinarUrl ? (
          <video controls autoPlay playsInline src={webinarUrl}>
            <track kind="captions" srcLang="en" label="English captions" />
          </video>
        ) : (
          <div className="video-empty">▶<small>Add a hosted video URL to play the webinar here.</small></div>
        )}
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
