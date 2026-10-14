"use client";

import { useActionState } from "react";
import type { PublishState } from "@/app/(dashboard)/content/actions";
import type { PublicationStatus } from "@/lib/api/types";

interface PublishControlsProps {
  status: PublicationStatus;
  publish: (previous: PublishState, formData: FormData) => Promise<PublishState>;
  unpublish: (previous: PublishState, formData: FormData) => Promise<PublishState>;
  /** Why publishing is not possible yet, or null when it is. */
  publishBlockedReason: string | null;
}

export function PublishControls({ status, publish, unpublish, publishBlockedReason }: PublishControlsProps) {
  const [publishState, publishAction, publishing] = useActionState(publish, { status: "idle" });
  const [unpublishState, unpublishAction, unpublishing] = useActionState(unpublish, { status: "idle" });
  const error =
    publishState.status === "error" ? publishState.message : unpublishState.status === "error" ? unpublishState.message : null;
  const busy = publishing || unpublishing;

  return (
    <div className="stack">
      {error ? (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
      <div className="actions">
        {status === "published" ? (
          <form action={unpublishAction}>
            <button type="submit" className="btn" disabled={busy}>
              {unpublishing ? "Unpublishing…" : "Unpublish"}
            </button>
          </form>
        ) : (
          <form action={publishAction}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || publishBlockedReason !== null}
              aria-describedby={publishBlockedReason ? "publish-blocked-reason" : undefined}
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          </form>
        )}
      </div>
      {status !== "published" && publishBlockedReason ? (
        <p className="hint" id="publish-blocked-reason">
          {publishBlockedReason}
        </p>
      ) : null}
    </div>
  );
}
