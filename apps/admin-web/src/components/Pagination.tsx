import Link from "next/link";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the link for a page number, keeping the current filters. */
  hrefFor: (page: number) => string;
}

export function Pagination({ page, pageSize, total, hrefFor }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label="Pagination"
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}
    >
      <span className="muted">
        {total === 0 ? "No results" : `Showing ${first}–${last} of ${total}`}
      </span>
      <span className="actions">
        {page > 1 ? (
          <Link className="btn btn-small" href={hrefFor(page - 1)} rel="prev">
            Previous
          </Link>
        ) : (
          <span className="btn btn-small" aria-disabled="true">
            Previous
          </span>
        )}
        <span className="muted">
          Page {Math.min(page, totalPages)} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link className="btn btn-small" href={hrefFor(page + 1)} rel="next">
            Next
          </Link>
        ) : (
          <span className="btn btn-small" aria-disabled="true">
            Next
          </span>
        )}
      </span>
    </nav>
  );
}
