import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessBadge, LockIcon, PlayIcon } from "@/components/content/badges";
import { Thumbnail } from "@/components/content/Thumbnail";
import { ApiError } from "@/lib/api/errors";
import type { ContentDetail, ContentSummary } from "@/lib/api/types";
import { getConfig } from "@/lib/config";
import { SITE_NAME, formatDuration, kindLabel, languageName, truncate } from "@/lib/format";
import { isUuid } from "@/lib/session/codec";
import { getContent, getViewerAccess } from "@/lib/viewer";
import styles from "./page.module.css";

type Props = { params: Promise<{ id: string }> };

async function loadContent(id: string): Promise<ContentDetail | null> {
  if (!isUuid(id)) return null;
  try {
    return await getContent(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const content = await loadContent(id);
  if (!content) return { title: "Not found", robots: { index: false } };

  const description = truncate(content.description || `${kindLabel(content.kind)} on ${SITE_NAME}`);
  const path = `/content/${content.id}`;
  const images = content.thumbnailUrl ? [{ url: content.thumbnailUrl, alt: content.title }] : undefined;
  return {
    title: content.title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: content.title,
      description,
      url: path,
      type: content.kind === "course" ? "website" : "video.other",
      images,
    },
    twitter: { card: images ? "summary_large_image" : "summary", title: content.title, description, images },
  };
}

function jsonLd(content: ContentDetail): string {
  const { siteUrl } = getConfig();
  const url = `${siteUrl}/content/${content.id}`;
  const data =
    content.kind === "course"
      ? {
          "@context": "https://schema.org",
          "@type": "Course",
          name: content.title,
          description: content.description,
          url,
          inLanguage: content.defaultLanguage,
          provider: { "@type": "Organization", name: SITE_NAME, url: siteUrl },
          ...(content.thumbnailUrl ? { image: content.thumbnailUrl } : {}),
        }
      : {
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          name: content.title,
          description: content.description,
          url,
          inLanguage: content.defaultLanguage,
          isAccessibleForFree: content.accessTier === "free",
          ...(content.thumbnailUrl ? { image: content.thumbnailUrl } : {}),
        };
  // Escape "<" so the JSON can never close the script element.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function LessonRow({
  lesson,
  index,
  locked,
  signedIn,
}: {
  lesson: ContentSummary;
  index: number;
  locked: boolean;
  signedIn: boolean;
}) {
  const duration = formatDuration(lesson.durationSeconds);
  return (
    <li className={styles.lesson} data-testid="lesson" data-tier={lesson.accessTier} data-locked={locked}>
      <span className={styles.lessonIndex}>{index + 1}</span>
      <div className={styles.lessonBody}>
        <Link href={`/content/${lesson.id}`} className={styles.lessonTitle}>
          {lesson.title}
        </Link>
        <span className={styles.lessonMeta}>
          <AccessBadge tier={lesson.accessTier} />
          {duration ? <span>{duration}</span> : null}
        </span>
      </div>
      <div className={styles.lessonAction}>
        {locked ? (
          <>
            <LockIcon />
            <Link href={signedIn ? "/subscribe" : `/login?next=${encodeURIComponent("/subscribe")}`} className="btn btn-secondary btn-small">
              Unlock
            </Link>
          </>
        ) : (
          <Link
            href={`/watch/${lesson.id}`}
            className="btn btn-primary btn-small"
            data-testid="play-lesson"
            aria-label={`Play ${lesson.title}`}
          >
            <PlayIcon /> Play
          </Link>
        )}
      </div>
    </li>
  );
}

export default async function ContentPage({ params }: Props) {
  const { id } = await params;
  const content = await loadContent(id);
  if (!content) notFound();

  const access = await getViewerAccess();
  const isLocked = (item: { accessTier: string }) => item.accessTier === "premium" && !access.hasAccess;
  const duration = formatDuration(content.durationSeconds);
  const lessons = content.children;
  const locked = isLocked(content);

  return (
    <article className={styles.article}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(content) }} />
      <div className={`container ${styles.layout}`}>
        <div className={styles.media}>
          <Thumbnail src={content.thumbnailUrl} title={content.title} priority />
        </div>

        <div className={styles.info}>
          {content.parentId ? (
            <Link href={`/content/${content.parentId}`} className={styles.back}>
              ← Back to course
            </Link>
          ) : null}
          <p className={styles.meta}>
            <AccessBadge tier={content.accessTier} />
            <span>{kindLabel(content.kind)}</span>
            {duration ? <span>{duration}</span> : null}
            <span>{languageName(content.defaultLanguage)}</span>
            {content.ageRating ? <span className="badge badge-neutral">{content.ageRating}</span> : null}
          </p>
          <h1 className={styles.title}>{content.title}</h1>
          <p className={styles.description}>{content.description}</p>

          {content.subtitles.length > 0 ? (
            <p className="subtle">Subtitles: {content.subtitles.map((s) => s.label).join(", ")}</p>
          ) : null}

          <div className={styles.actions}>
            {content.kind !== "course" ? (
              !content.playable ? (
                <p className="muted">This video is not available to play yet.</p>
              ) : locked ? (
                <>
                  <span className={styles.lockedNote}>
                    <LockIcon /> Premium
                  </span>
                  <Link href="/subscribe" className="btn btn-primary">
                    Subscribe to watch
                  </Link>
                </>
              ) : (
                <Link href={`/watch/${content.id}`} className="btn btn-primary" data-testid="play-content">
                  <PlayIcon /> Play
                </Link>
              )
            ) : lessons.length > 0 ? (
              (() => {
                const first = lessons.find((lesson) => !isLocked(lesson));
                return first ? (
                  <Link href={`/watch/${first.id}`} className="btn btn-primary">
                    <PlayIcon /> {first === lessons[0] ? "Start course" : "Play free lesson"}
                  </Link>
                ) : (
                  <Link href="/subscribe" className="btn btn-primary">
                    Subscribe to start
                  </Link>
                );
              })()
            ) : null}
            {!access.hasAccess && content.kind === "course" && lessons.some(isLocked) ? (
              <Link href="/subscribe" className="btn btn-secondary">
                Unlock all lessons
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {content.kind === "course" ? (
        <section className="container" aria-labelledby="lessons-title">
          <h2 id="lessons-title" className={styles.sectionTitle}>
            Lessons <span className="subtle">({lessons.length})</span>
          </h2>
          {lessons.length === 0 ? (
            <p className="muted">Lessons are coming soon.</p>
          ) : (
            <ol className={styles.lessons}>
              {lessons.map((lesson, index) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  index={index}
                  locked={isLocked(lesson)}
                  signedIn={access.signedIn}
                />
              ))}
            </ol>
          )}
          <p className="subtle">
            Lock icons are a guide only; access is always checked when you press play.
          </p>
        </section>
      ) : null}
    </article>
  );
}
