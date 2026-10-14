import type { Metadata } from "next";
import Link from "next/link";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Pagination } from "@/components/Pagination";
import { AccountBadge, Badge, SubscriptionBadge } from "@/components/StatusBadge";
import { searchUsers } from "@/lib/api/admin";
import { formatDate, humanize } from "@/lib/format";
import { firstParam, loadPageData, pageParam, type SearchParams } from "@/lib/page-data";

export const metadata: Metadata = { title: "Users" };

const PAGE_SIZE = 20;

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const email = (firstParam(params, "email") ?? "").trim();
  const page = pageParam(params);

  // Without an email the API lists everyone, newest first.
  const result = await loadPageData(() =>
    searchUsers({ email: email || undefined, page, pageSize: PAGE_SIZE }),
  );

  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    if (email) query.set("email", email);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/users?${text}` : "/users";
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p>
            {email
              ? "Search results. Open a user to see their subscription, devices and active playback."
              : "Newest accounts first. Search by email, or open a user to see their subscription, devices and active playback."}
          </p>
        </div>
      </div>

      <form method="get" action="/users" className="card" role="search" aria-label="Search users">
        <div className="form-grid" style={{ alignItems: "end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="user-email">Email</label>
            <input
              id="user-email"
              name="email"
              type="search"
              placeholder="name@example.com or part of it"
              defaultValue={email}
              autoComplete="off"
            />
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary">
              Search
            </button>
            {email ? (
              <Link href="/users" className="btn">
                Show all
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {result.ok ? (
        <div className="card">
          {result.data.items.length === 0 ? (
            <p className="empty">{email ? `No users match “${email}”.` : "No users yet."}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Name</th>
                    <th scope="col">Role</th>
                    <th scope="col">Account</th>
                    <th scope="col">Subscription</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map(({ user, subscription }) => (
                    <tr key={user.id}>
                      <td>
                        <Link href={`/users/${user.id}`}>{user.email}</Link>
                      </td>
                      <td>{user.displayName ?? <span className="muted">—</span>}</td>
                      <td>{humanize(user.role)}</td>
                      <td>
                        <AccountBadge status={user.accountStatus} />
                      </td>
                      <td>
                        <span className="actions">
                          <SubscriptionBadge status={subscription.status} />
                          {subscription.hasAccess ? <Badge tone="success">Has access</Badge> : null}
                        </span>
                      </td>
                      <td className="muted">{formatDate(user.createdAt)}</td>
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
