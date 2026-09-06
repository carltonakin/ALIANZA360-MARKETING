import { LandingVideoPlayer } from "../../components/LandingVideoPlayer";
import { BrandLogo } from "../../components/BrandLogo";
import { resolveSocialListenerConfig } from "../../api/social/_config";
import { RegisterForm } from "./RegisterForm";

type Landing = {
  id: string;
  slug: string;
  headline: string;
  teaser: string;
  webinarUrl: string;
  paymentUrl: string;
  status: string;
  videoSourceType?: "NONE" | "UPLOAD" | "EXTERNAL_URL";
  videoUrl?: string;
  videoProvider?: "CLOUDINARY" | "YOUTUBE" | "VIMEO" | "CANVA" | null;
  videoAutoplay?: boolean;
  videoMuted?: boolean;
  videoShowControls?: boolean;
  preVideoCtaText?: string;
  preVideoCtaUrl?: string;
  submitButtonText?: string;
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
    return body.pages?.find((page) => page.slug === slug && page.status !== "archived") || null;
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
          <p>This webinar page may be unpublished, the link may be incorrect, or the SQL Server backend is unavailable.</p>
        </div>
      </main>
    );
  }

  const hasCta = Boolean(page.preVideoCtaText && page.preVideoCtaUrl);
  return (
    <main className="landing-shell">
      <header className="landing-nav">
        <BrandLogo className="landing-brand-logo" />
        <small>FREE · ON DEMAND · PRACTICAL</small>
      </header>
      <section className="landing-hero">
        <div className="teaser-side">
          <span className="lp-eyebrow">BUILD A BETTER GROWTH ENGINE</span>
          <h1>{page.headline}</h1>
          {hasCta && <a className="lp-button landing-video-cta" href={page.preVideoCtaUrl}>{page.preVideoCtaText}</a>}
          <LandingVideoPlayer
            sourceType={page.videoSourceType}
            videoUrl={page.videoUrl}
            provider={page.videoProvider}
            autoplay={page.videoAutoplay !== false}
            muted={page.videoMuted !== false}
            showControls={page.videoShowControls !== false}
          />
          <p>{page.teaser || "Discover a practical system to attract the right audience, convert interest into qualified leads and build recurring revenue."}</p>
          <div className="proof">
            <span>✓ Actionable framework</span>
            <span>✓ Watch instantly</span>
            <span>✓ Free access</span>
          </div>
        </div>
        <RegisterForm
          pageId={page.id}
          paymentUrl={page.paymentUrl}
          submitButtonText={page.submitButtonText}
        />
      </section>
    </main>
  );
}
