import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentForm } from "@/components/ContentForm";
import { ErrorPanel } from "@/components/ErrorPanel";
import { PublishControls } from "@/components/PublishControls";
import { Badge, ProcessingBadge, PublicationBadge } from "@/components/StatusBadge";
import { UploadPanel } from "@/components/UploadPanel";
import { getContent } from "@/lib/api/admin";
import type { AdminContent, AdminContentWithChildren } from "@/lib/api/types";
import { contentToValues } from "@/lib/content-form";
import { formatDateTime, formatDuration, humanize } from "@/lib/format";
import { isUuid, loadPageData } from "@/lib/page-data";
import { publishAction, unpublishAction, updateContentAction } from "../actions";

export const metadata: Metadata = { title: "Content" };

function publishBlockedReason(content: AdminContent): string | null {
  if (content.kind === "course") return null;
  const status = content.asset?.processingStatus;
  if (status === "ready") return null;
  if (status === "processing") return "Publishing unlocks when the video has finished processing.";
  if (status === "failed") return "Video processing failed. Upload the video again before publishing.";
  return "Upload a video and wait until it is ready before publishing.";
}

/**
 * Who can see this item. A lesson is visible only while both the lesson and its course are
 * published; a lesson may be published first so a whole course can be released in one step.
 */
function visibilityText(content: AdminContent, parent: AdminContent | null): string {
  const regions = content.regions.join(", ");
  if (content.kind !== "lesson") {
    return content.publicationStatus === "published" ? `Visible to viewers in ${regions}.` : "Not visible to viewers.";
  }
  const course = parent ? `the course “${parent.title}”` : "its course";
  const coursePublished = parent?.publicationStatus === "published";
  if (content.publicationStatus === "published") {
    if (parent === null) {
      return `Published. Viewers see this lesson only while ${course} is also published.`;
    }
    return coursePublished
      ? `Visible to viewers in ${regions}, because ${course} is published too.`
      : `Published, but hidden from viewers until ${course} is published.`;
  }
  return coursePublished
    ? "Not visible to viewers. Publish it to show it in the course."
    : `Not visible to viewers. A published lesson becomes visible once ${course} is published too.`;
}

/** Lessons in course order: position (0-based), ties by creation time. */
function sortLessons(children: AdminContent[]): AdminContent[] {
  return [...children].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }

  const result = await loadPageData(() => getContent(id));
  if (!result.ok) {
    return <ErrorPanel error={result.error} />;
  }
  const content = result.data;

  let parent: AdminContentWithChildren | null = null;
  if (content.parentId) {
    const parentResult = await loadPageData(() => getContent(content.parentId as string)).catch(() => null);
    parent = parentResult?.ok ? parentResult.data : null;
  }

  const lessons = sortLessons(content.children);
  const publishedLessons = lessons.filter((lesson) => lesson.publicationStatus === "published").length;
  const playable = content.kind !== "course";

  return (
    <>
      <div className="breadcrumbs">
        <Link href="/content">Content</Link>
        {parent ? (
          <>
            {" › "}
            <Link href={`/content/${parent.id}`}>{parent.title}</Link>
          </>
        ) : null}
        {" › "}
        {content.title}
      </div>

      <div className="page-header">
        <div>
          <h1>{content.title}</h1>
          <p className="actions" style={{ marginTop: "0.5rem" }}>
            <Badge>{humanize(content.kind)}</Badge>
            <Badge tone={content.accessTier === "premium" ? "info" : "neutral"}>{humanize(content.accessTier)}</Badge>
          </p>
        </div>
      </div>

      <section className="card" aria-labelledby="publication-heading">
        <div className="card-header">
          <h2 id="publication-heading">Publication</h2>
          <span data-testid="publication-status">
            <PublicationBadge status={content.publicationStatus} />
          </span>
        </div>
        <p className="muted" style={{ marginTop: 0 }} data-testid="visibility-hint">
          {visibilityText(content, parent)}
        </p>
        <PublishControls
          key={content.id}
          status={content.publicationStatus}
          publish={publishAction.bind(null, content.id)}
          unpublish={unpublishAction.bind(null, content.id)}
          publishBlockedReason={publishBlockedReason(content)}
        />
      </section>

      {playable ? (
        <UploadPanel
          key={content.id}
          contentId={content.id}
          serverStatus={content.asset?.processingStatus ?? null}
          published={content.publicationStatus === "published"}
        />
      ) : null}

      {content.kind === "course" ? (
        <section className="card" aria-labelledby="lessons-heading">
          <div className="card-header">
            <h2 id="lessons-heading">Lessons</h2>
            <Link href={`/content/new?kind=lesson&parentId=${content.id}`} className="btn btn-primary btn-small">
              Add lesson
            </Link>
          </div>
          <p className="hint" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
            Viewers see a lesson only while both the lesson and this course are published.
            {content.publicationStatus !== "published" && publishedLessons > 0
              ? ` Publishing this course releases its ${publishedLessons} published lesson${publishedLessons === 1 ? "" : "s"}.`
              : null}
          </p>
          {lessons.length === 0 ? (
            <p className="empty">No lessons yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Title</th>
                    <th scope="col">Status</th>
                    <th scope="col">Video</th>
                    <th scope="col">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {lessons.map((lesson, index) => (
                    <tr key={lesson.id}>
                      <td title={`Position ${lesson.position}`}>{index + 1}</td>
                      <td>
                        <Link href={`/content/${lesson.id}`}>{lesson.title}</Link>
                      </td>
                      <td>
                        <PublicationBadge status={lesson.publicationStatus} />
                      </td>
                      <td>
                        <ProcessingBadge status={lesson.asset?.processingStatus ?? null} />
                      </td>
                      <td>{formatDuration(lesson.durationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className="card" aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
        <ContentForm
          key={content.id}
          mode="edit"
          action={updateContentAction.bind(null, content.id)}
          initialValues={contentToValues(content)}
          kindOptions={[{ value: content.kind, label: humanize(content.kind) }]}
          submitLabel="Save changes"
        />
      </section>

      <section className="card" aria-labelledby="meta-heading">
        <h2 id="meta-heading">Record</h2>
        <dl className="details">
          <dt>ID</dt>
          <dd className="mono">{content.id}</dd>
          {content.asset ? (
            <>
              <dt>Video asset</dt>
              <dd className="mono">{content.asset.id}</dd>
            </>
          ) : null}
          <dt>Thumbnail</dt>
          <dd>
            {content.thumbnailUrl && /^https?:\/\//i.test(content.thumbnailUrl) ? (
              <a href={content.thumbnailUrl} target="_blank" rel="noopener noreferrer">
                Open image
              </a>
            ) : (
              (content.thumbnailUrl ?? "—")
            )}
          </dd>
          <dt>Duration</dt>
          <dd>{formatDuration(content.durationSeconds)}</dd>
          <dt>Created</dt>
          <dd>{formatDateTime(content.createdAt)}</dd>
          <dt>Updated</dt>
          <dd>{formatDateTime(content.updatedAt)}</dd>
        </dl>
      </section>
    </>
  );
}
