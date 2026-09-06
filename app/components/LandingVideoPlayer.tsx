"use client";

type LandingVideoProvider = "CLOUDINARY" | "YOUTUBE" | "VIMEO" | "CANVA";

type LandingVideoPlayerProps = {
  sourceType?: "NONE" | "UPLOAD" | "EXTERNAL_URL";
  videoUrl?: string | null;
  provider?: LandingVideoProvider | null;
  autoplay?: boolean;
  muted?: boolean;
  showControls?: boolean;
  className?: string;
  title?: string;
  onPlaybackError?: () => void;
};

export function LandingVideoPlayer({
  sourceType,
  videoUrl,
  provider,
  autoplay = true,
  muted = true,
  showControls = true,
  className = "landing-video",
  title,
  onPlaybackError,
}: LandingVideoPlayerProps) {
  if (!videoUrl || !provider || sourceType === "NONE") return null;

  if (provider === "CLOUDINARY") {
    return (
      <div className={className} data-provider="cloudinary">
        <video
          src={videoUrl}
          autoPlay={autoplay}
          muted={muted}
          playsInline
          controls={showControls}
          preload="metadata"
          onError={onPlaybackError}
        >
          <track kind="captions" srcLang="en" label="English captions" />
        </video>
      </div>
    );
  }

  return (
    <div className={className} data-provider={provider.toLowerCase()}>
      <iframe
        src={videoUrl}
        title={title || `${provider} landing-page video`}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={onPlaybackError}
      />
    </div>
  );
}
