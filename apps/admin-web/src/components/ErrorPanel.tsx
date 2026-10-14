import Link from "next/link";
import type { PageError } from "@/lib/page-data";
import { RetryButton } from "./RetryButton";

const TITLES: Record<PageError["kind"], string> = {
  forbidden: "Admin access required",
  network: "The API is unreachable",
  other: "Something went wrong",
};

/** Friendly replacement for a page whose API data could not be loaded. */
export function ErrorPanel({ error }: { error: PageError }) {
  return (
    <div className="card" role="alert">
      <h2>{TITLES[error.kind]}</h2>
      <p>{error.message}</p>
      <div className="actions">
        {error.kind === "forbidden" ? (
          <form method="post" action="/auth/logout">
            <button type="submit" className="btn btn-primary">
              Sign in with another account
            </button>
          </form>
        ) : (
          <RetryButton />
        )}
        <Link href="/content" className="btn">
          Go to content
        </Link>
      </div>
    </div>
  );
}
