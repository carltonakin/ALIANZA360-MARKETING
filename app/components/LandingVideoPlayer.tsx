"use client";

import { useState } from "react";

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
  const [failedVideoUrl, setFailedVideoUrl] = useState<string | null>(null);
  const playbackFailed = failedVideoUrl === videoUrl;

  if (!videoUrl) return null;

  const reportPlaybackFailure = () => {
    setFailedVideoUrl(videoUrl || null);
    onPlaybackError?.();
  };

  if (!provider || playbackFailed) {
    return (
      <div className={`${className} landing-video-fallback`} data-source={sourceType?.toLowerCase()} role="status">
        <strong>Video unavailable</strong>
        <span>The video could not be loaded. Please try again or open it directly.</span>
        <a href={videoUrl} target="_blank" rel="noreferrer">Open video</a>
      </div>
    );
  }

  if (provider === "CLOUDINARY") {
    return (
      <div className={className} data-provider="cloudinary" data-source={sourceType?.toLowerCase()}>
        <video
          src={videoUrl}
          autoPlay={autoplay}
          muted={muted}
          playsInline
          controls={showControls}
          preload="metadata"
          onError={reportPlaybackFailure}
        >
          <track kind="captions" srcLang="en" label="English captions" />
        </video>
      </div>
    );
  }

  return (
    <div className={className} data-provider={provider.toLowerCase()} data-source={sourceType?.toLowerCase()}>
      <iframe
        src={videoUrl}
        title={title || `${provider} landing-page video`}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={reportPlaybackFailure}
      />
    </div>
  );
}
