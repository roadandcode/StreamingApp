import type { Metadata } from "next";
import Link from "next/link";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Pagination } from "@/components/Pagination";
import { Badge, ProcessingBadge, PublicationBadge } from "@/components/StatusBadge";
import { listContent } from "@/lib/api/admin";
import { PUBLICATION_STATUSES, type ContentKind, type PublicationStatus } from "@/lib/api/types";
import { formatDateTime, humanize } from "@/lib/format";
import { firstParam, loadPageData, pageParam, type SearchParams } from "@/lib/page-data";

export const metadata: Metadata = { title: "Content" };

const PAGE_SIZE = 20;

/** Without parentId the API lists top-level items only; lessons are listed on their course. */
const LIST_KINDS: readonly ContentKind[] = ["course", "video"];

export default async function ContentListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const kindParam = firstParam(params, "kind");
  const statusParam = firstParam(params, "status");
  const kind = LIST_KINDS.includes(kindParam as ContentKind) ? (kindParam as ContentKind) : undefined;
  const status = PUBLICATION_STATUSES.includes(statusParam as PublicationStatus)
    ? (statusParam as PublicationStatus)
    : undefined;
  const page = pageParam(params);

  const result = await loadPageData(() => listContent({ kind, status, page, pageSize: PAGE_SIZE }));

  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    if (kind) query.set("kind", kind);
    if (status) query.set("status", status);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/content?${text}` : "/content";
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Content</h1>
          <p>Courses and standalone videos, newest changes first. Lessons are listed on their course.</p>
        </div>
        <div className="actions">
          <Link href="/content/new?kind=course" className="btn btn-primary">
            New course
          </Link>
          <Link href="/content/new?kind=video" className="btn btn-primary">
            New video
          </Link>
        </div>
      </div>

      <form method="get" action="/content" className="card" aria-label="Filter content">
        <div className="form-grid" style={{ alignItems: "end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-kind">Type</label>
            <select id="filter-kind" name="kind" defaultValue={kind ?? ""}>
              <option value="">All types</option>
              {LIST_KINDS.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-status">Status</label>
            <select id="filter-status" name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              {PUBLICATION_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button type="submit" className="btn">
              Apply filters
            </button>
            {kind || status ? (
              <Link href="/content" className="btn">
                Clear
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {result.ok ? (
        <div className="card">
          {result.data.items.length === 0 ? (
            <p className="empty">
              {kind || status ? "No content matches these filters." : "No content yet. Create a course or a video to get started."}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col">Access</th>
                    <th scope="col">Video</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/content/${item.id}`}>{item.title}</Link>
                      </td>
                      <td>{humanize(item.kind)}</td>
                      <td>
                        <PublicationBadge status={item.publicationStatus} />
                      </td>
                      <td>
                        <Badge tone={item.accessTier === "premium" ? "info" : "neutral"}>
                          {humanize(item.accessTier)}
                        </Badge>
                      </td>
                      <td>
                        {item.kind === "course" ? (
                          <span className="muted">—</span>
                        ) : (
                          <ProcessingBadge status={item.asset?.processingStatus ?? null} />
                        )}
                      </td>
                      <td className="muted">{formatDateTime(item.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={result.data.page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            hrefFor={hrefFor}
          />
        </div>
      ) : (
        <ErrorPanel error={result.error} />
      )}
    </>
  );
}
