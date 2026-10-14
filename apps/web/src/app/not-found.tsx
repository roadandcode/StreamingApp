import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container page narrow">
      <h1>Page not found</h1>
      <p className="muted">This title may have been removed, or it is not available in your country.</p>
      <Link href="/" className="btn btn-primary">
        Browse the catalog
      </Link>
    </div>
  );
}
