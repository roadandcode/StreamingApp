"use client";

import Link from "next/link";

/** Last-resort boundary for unexpected errors while rendering a dashboard page. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card" role="alert">
      <h2>Something went wrong</h2>
      <p>The page could not be displayed. This is usually temporary; try again in a moment.</p>
      {error.digest ? <p className="hint">Reference: {error.digest}</p> : null}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/content" className="btn">
          Go to content
        </Link>
      </div>
    </div>
  );
}
