"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Login could not be completed.");
      router.replace("/dashboard");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login could not be completed.");
      setPending(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-brand">
        <div className="brand-mark"><span>360</span></div>
        <p>ALIANZA CRM • MARKETING</p>
        <h1>Welcome back to your growth engine.</h1>
        <p>Sign in to manage leads, campaigns, automation, and customer journeys.</p>
      </section>
      <section className="login-card" aria-labelledby="login-title">
        <span className="login-eyebrow">SECURE ACCESS</span>
        <h2 id="login-title">Sign in</h2>
        <p>Use your CRM username and password.</p>
        <form onSubmit={submit}>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" required disabled={pending} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required disabled={pending} />
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="primary login-submit" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
