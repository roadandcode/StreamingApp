import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <div className="card">
      <h2>Not found</h2>
      <p>This item does not exist or has been removed.</p>
      <div className="actions">
        <Link href="/content" className="btn btn-primary">
          Go to content
        </Link>
        <Link href="/users" className="btn">
          Go to users
        </Link>
      </div>
    </div>
  );
}
