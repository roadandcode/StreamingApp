"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackController, type PlayerState } from "@/lib/player/controller";
import styles from "./WebPlayer.module.css";
import { Watermark } from "./Watermark";

export interface WebPlayerProps {
  contentId: string;
  viewerEmail: string;
  requireDrm: boolean;
  maxVideoHeight: number;
}

function StopActions({ code, retryable, onRetry, contentId }: { code: string; retryable: boolean; onRetry: () => void; contentId: string }) {
  const here = `/watch/${contentId}`;
  if (code === "ENTITLEMENT_REQUIRED") {
    return (
      <Link href="/subscribe" className="btn btn-primary" data-testid="player-subscribe">
        See plans
      </Link>
    );
  }
  if (code === "DEVICE_NOT_REGISTERED") {
    return (
      <Link href={`/device?next=${encodeURIComponent(here)}`} className="btn btn-primary">
        Register this browser
      </Link>
    );
  }
  if (code === "DEVICE_REVOKED") {
    return (
      <Link href={`/device?reason=blocked&next=${encodeURIComponent(here)}`} className="btn btn-secondary">
        Device details
      </Link>
    );
  }
  if (code === "UNAUTHENTICATED") {
    return (
      <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn btn-primary">
        Sign in again
      </Link>
    );
  }
  if (retryable) {
    return (
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        Try again
      </button>
    );
  }
  return null;
}

/** The web player. Rendered only in the browser (see PlayerLoader). */
export default function WebPlayer({ contentId, viewerEmail, requireDrm, maxVideoHeight }: WebPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const [state, setState] = useState<PlayerState>({ kind: "starting" });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const controller = new PlaybackController({ contentId, video, requireDrm, maxVideoHeight, onState: setState });
    controllerRef.current = controller;
    void controller.start();
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [contentId, requireDrm, maxVideoHeight]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Full screen applies to the container, not the <video>, so the watermark stays visible.
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void container.requestFullscreen?.().catch(() => undefined);
  }, []);

  const retry = useCallback(() => void controllerRef.current?.start(), []);

  return (
    <div className={styles.shell}>
      <div
        ref={containerRef}
        className={styles.container}
        data-testid="player"
        data-state={state.kind}
        onDoubleClick={toggleFullscreen}
      >
        <video
          ref={videoRef}
          className={styles.video}
          controls={state.kind === "playing"}
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
          onContextMenu={(event) => event.preventDefault()}
          aria-label="Video player"
        />
        <Watermark text={viewerEmail} />

        {state.kind === "starting" || state.kind === "resuming" ? (
          <div className={styles.overlay} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            <span>{state.kind === "starting" ? "Starting playback…" : "Resuming…"}</span>
          </div>
        ) : null}

        {state.kind === "paused-hidden" ? (
          <div className={styles.overlay} role="status">
            <span>Paused while you were away. Come back to this tab to continue.</span>
          </div>
        ) : null}

        {state.kind === "stopped" ? (
          <div className={`${styles.overlay} ${styles.stopped}`} role="alert" data-testid="player-error" data-code={state.code}>
            <p className={styles.stopMessage}>{state.message}</p>
            <StopActions code={state.code} retryable={state.retryable} onRetry={retry} contentId={contentId} />
          </div>
        ) : null}
      </div>

      <div className={styles.toolbar}>
        <span className="subtle">Video quality up to {maxVideoHeight}p in the browser.</span>
        <button type="button" className="btn btn-secondary btn-small" onClick={toggleFullscreen} disabled={state.kind !== "playing"}>
          {isFullscreen ? "Exit full screen" : "Full screen"}
        </button>
      </div>
    </div>
  );
}
