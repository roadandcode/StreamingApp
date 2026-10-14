import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccessBadge } from "@/components/content/badges";
import { PlayerLoader } from "@/components/player/PlayerLoader";
import { ApiError } from "@/lib/api/errors";
import type { ContentDetail } from "@/lib/api/types";
import { getConfig } from "@/lib/config";
import { formatDuration, kindLabel } from "@/lib/format";
import { loginPath } from "@/lib/navigation";
import { isUuid } from "@/lib/session/codec";
import { readSession } from "@/lib/session/server";
import { getContent } from "@/lib/viewer";
import styles from "./page.module.css";

type Props = { params: Promise<{ contentId: string }> };

export const metadata: Metadata = { title: "Watch", robots: { index: false, follow: false } };

async function loadContent(id: string): Promise<ContentDetail | null> {
  try {
    return await getContent(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export default async function WatchPage({ params }: Props) {
  const { contentId } = await params;
  if (!isUuid(contentId)) notFound();
  const here = `/watch/${contentId}`;

  const session = await readSession();
  if (!session) redirect(loginPath(here));
  if (!session.deviceId) redirect(`/device?next=${encodeURIComponent(here)}`);

  const content = await loadContent(contentId);
  if (!content) notFound();
  // A course is a container of lessons and has no video of its own.
  if (content.kind === "course") redirect(`/content/${content.id}`);

  const config = getConfig();
  const duration = formatDuration(content.durationSeconds);

  return (
    <div className={`container ${styles.page}`}>
      <PlayerLoader
        contentId={content.id}
        viewerEmail={session.user.email}
        requireDrm={config.requireDrm}
        maxVideoHeight={config.maxVideoHeight}
      />
      <div className={styles.details}>
        <div>
          <p className={styles.meta}>
            <AccessBadge tier={content.accessTier} />
            <span>{kindLabel(content.kind)}</span>
            {duration ? <span>{duration}</span> : null}
          </p>
          <h1 className={styles.title}>{content.title}</h1>
          <p className="muted">{content.description}</p>
        </div>
        <Link href={content.parentId ? `/content/${content.parentId}` : `/content/${content.id}`} className="btn btn-secondary">
          {content.parentId ? "All lessons" : "Details"}
        </Link>
      </div>
    </div>
  );
}
