"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { startUploadAction } from "@/app/(dashboard)/content/actions";
import type { ProcessingStatus, UploadSession } from "@/lib/api/types";
import type { ContentStatusResponse } from "@/lib/content-status";
import { ProcessingBadge } from "./StatusBadge";
import styles from "./UploadPanel.module.css";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 15 * 60_000;

type Phase =
  | { name: "idle" }
  | { name: "requesting" }
  | { name: "uploading"; loaded: number; total: number }
  | { name: "processing" }
  | { name: "ready" }
  | { name: "failed" }
  | { name: "error"; message: string };

class UploadError extends Error {}

/** Sends the file straight from the browser to the signed upload URL, reporting progress. */
function sendFile(
  session: UploadSession,
  file: File,
  xhrRef: { current: XMLHttpRequest | null },
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open(session.method, session.uploadUrl);
    // The URL is pre-signed; no cookies or admin credentials go with it.
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(session.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else if (xhr.status === 401 || xhr.status === 403) {
        reject(new UploadError("The upload link was rejected or has expired. Try uploading again."));
      } else {
        reject(new UploadError(`The upload failed (HTTP ${xhr.status}). Try again.`));
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      reject(new UploadError("The upload failed. Check your connection and try again."));
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      reject(new UploadError("Upload cancelled."));
    };
    xhr.send(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function initialPhase(status: ProcessingStatus | null): Phase {
  if (status === "processing") return { name: "processing" };
  if (status === "ready") return { name: "ready" };
  if (status === "failed") return { name: "failed" };
  return { name: "idle" };
}

/**
 * `serverStatus` is the asset status from the latest server render. The page can re-render while
 * an upload is running (for example when a server action rotates the session cookie), so the
 * panel must never be remounted by such updates: that would abort the upload. It only adopts
 * the server status while it is not busy.
 */
export function UploadPanel({
  contentId,
  serverStatus,
  published,
}: {
  contentId: string;
  serverStatus: ProcessingStatus | null;
  published: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(() => initialPhase(serverStatus));
  const [seenServerStatus, setSeenServerStatus] = useState(serverStatus);
  const [file, setFile] = useState<File | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = phase.name === "requesting" || phase.name === "uploading" || phase.name === "processing";
  const hasReadyVideo = phase.name === "ready";

  if (serverStatus !== seenServerStatus) {
    setSeenServerStatus(serverStatus);
    if (!busy) {
      setPhase(initialPhase(serverStatus));
    }
  }

  // Poll the dashboard's status endpoint while the API processes the upload.
  useEffect(() => {
    if (phase.name !== "processing") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    async function poll() {
      try {
        const response = await fetch(`/api/content/${contentId}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (response.status === 401) {
          router.push(`/login?reason=expired&next=${encodeURIComponent(`/content/${contentId}`)}`);
          return;
        }
        if (response.ok) {
          const body = (await response.json()) as ContentStatusResponse;
          const status = body.asset?.processingStatus;
          if (cancelled) return;
          if (status === "ready" || status === "failed") {
            setPhase(status === "ready" ? { name: "ready" } : { name: "failed" });
            router.refresh();
            return;
          }
        }
      } catch {
        // Temporary network problem: keep polling.
      }
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setPhase({ name: "error", message: "The video is still processing. Refresh this page later to check on it." });
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    timer = setTimeout(poll, 250);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase.name, contentId, router]);

  // Abort an in-flight upload if the admin leaves the page.
  useEffect(() => () => xhrRef.current?.abort(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    const replaceWarning = published
      ? "Replace the video of this published item? Viewers cannot play it until the new video has finished processing. Unpublish first if that gap is not acceptable."
      : "Replace the current video? The new upload has to be processed again.";
    if (hasReadyVideo && !window.confirm(replaceWarning)) {
      return;
    }

    setPhase({ name: "requesting" });
    let session: UploadSession;
    try {
      const result = await startUploadAction(contentId);
      if (!result.ok) {
        setPhase({ name: "error", message: result.error });
        return;
      }
      session = result.data;
    } catch {
      setPhase({ name: "error", message: "Could not start the upload. Check your connection and try again." });
      return;
    }

    setPhase({ name: "uploading", loaded: 0, total: file.size });
    try {
      await sendFile(session, file, xhrRef, (loaded, total) => setPhase({ name: "uploading", loaded, total }));
    } catch (error) {
      setPhase({
        name: "error",
        message: error instanceof UploadError ? error.message : "The upload failed. Try again.",
      });
      return;
    }

    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
    setPhase({ name: "processing" });
  }

  const badgeStatus: ProcessingStatus | null =
    phase.name === "processing" || phase.name === "uploading" || phase.name === "requesting"
      ? phase.name === "processing"
        ? "processing"
        : "awaiting_upload"
      : phase.name === "ready"
        ? "ready"
        : phase.name === "failed"
          ? "failed"
          : serverStatus;

  const percent =
    phase.name === "uploading" && phase.total > 0 ? Math.min(100, Math.round((phase.loaded / phase.total) * 100)) : 0;

  return (
    <section className="card" aria-labelledby="video-heading">
      <div className="card-header">
        <h2 id="video-heading">Video</h2>
        <ProcessingBadge status={badgeStatus} />
      </div>

      <div aria-live="polite" className={styles.status}>
        {phase.name === "idle" ? (
          <p>
            {serverStatus === "awaiting_upload"
              ? "An upload was started but not finished. Choose the file and upload it again."
              : "No video uploaded yet. Choose a video file to upload."}
          </p>
        ) : null}
        {phase.name === "requesting" ? <p>Preparing the upload…</p> : null}
        {phase.name === "uploading" ? (
          <div className={styles.progressRow}>
            <progress
              className={styles.progress}
              value={phase.loaded}
              max={phase.total || 1}
              aria-label="Upload progress"
            />
            <span className={styles.percent}>{percent}%</span>
            <button type="button" className="btn btn-small" onClick={() => xhrRef.current?.abort()}>
              Cancel
            </button>
          </div>
        ) : null}
        {phase.name === "processing" ? <p>Upload complete. Processing the video… this page updates automatically.</p> : null}
        {phase.name === "ready" ? <p className={styles.ready}>The video is ready.</p> : null}
        {phase.name === "failed" ? (
          <p className="field-error">Processing failed. Upload the video again.</p>
        ) : null}
        {phase.name === "error" ? (
          <p className="field-error" role="alert">
            {phase.message}
          </p>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="video-file">{hasReadyVideo ? "Replace video" : "Video file"}</label>
          <input
            ref={inputRef}
            id="video-file"
            name="file"
            type="file"
            accept="video/*"
            disabled={busy}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? (
            <p className="hint">
              {file.name} ({formatBytes(file.size)})
            </p>
          ) : null}
        </div>
        <button type="submit" className="btn btn-primary" disabled={!file || busy}>
          {phase.name === "requesting" || phase.name === "uploading" ? "Uploading…" : "Upload video"}
        </button>
      </form>
    </section>
  );
}
