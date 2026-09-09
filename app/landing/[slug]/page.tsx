import { BrandLogo } from "../../components/BrandLogo";
import { LandingPageBlocks, type LandingPageBlock } from "../../components/LandingPageBlocks";
import { LandingPageViewTracker } from "../../components/LandingPageViewTracker";
import { resolveSocialListenerConfig } from "../../api/social/_config";
import { resolveLandingPageBlocks } from "../../../lib/landing-page-studio.mjs";

type Landing = {
  id: string;
  slug: string;
  title: string;
  headline: string;
  teaser: string;
  webinarUrl: string;
  paymentUrl: string;
  status: string;
  blocks?: LandingPageBlock[];
  [key: string]: unknown;
};

async function loadPage(slug: string): Promise<Landing | null> {
  const config = await resolveSocialListenerConfig();
  if (!config) return null;
  try {
    const response = await fetch(`${config.serviceUrl}/content`, {
      headers: { authorization: `Bearer ${config.serviceToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = await response.json() as { pages?: Landing[] };
    return body.pages?.find((page) => page.slug === slug && page.status === "published") || null;
  } catch {
    return null;
  }
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (!page) {
    return (
      <main className="landing-shell">
        <div className="landing-missing">
          <h1>Page not found</h1>
          <p>This page may be unpublished, the link may be incorrect, or the service may be temporarily unavailable.</p>
        </div>
      </main>
    );
  }
  const blocks = resolveLandingPageBlocks(page) as LandingPageBlock[];
  return (
    <main className="landing-shell">
      <LandingPageViewTracker pageId={page.id} />
      <header className="landing-nav">
        <BrandLogo className="landing-brand-logo" />
        <small>LANDING PAGE · SECURE REGISTRATION</small>
      </header>
      <LandingPageBlocks blocks={blocks} pageId={page.id} paymentUrl={page.paymentUrl} />
    </main>
  );
}
