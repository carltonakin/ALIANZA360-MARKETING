"use client";

import { useEffect } from "react";

export function LandingPageViewTracker({ pageId }: { pageId: string }) {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    void fetch("/api/landing-views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        pageId,
        source: query.get("utm_source") || "",
        medium: query.get("utm_medium") || "",
        campaign: query.get("utm_campaign") || "",
        content: query.get("utm_content") || "",
        term: query.get("utm_term") || "",
      }),
    }).catch(() => undefined);
  }, [pageId]);
  return null;
}
