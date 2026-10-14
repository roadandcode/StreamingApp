import type { Metadata } from "next";
import Link from "next/link";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Pagination } from "@/components/Pagination";
import { AccountBadge, Badge, SubscriptionBadge } from "@/components/StatusBadge";
import { searchUsers } from "@/lib/api/admin";
import { formatDate, humanize } from "@/lib/format";
import { firstParam, loadPageData, pageParam, type SearchParams } from "@/lib/page-data";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const email = (firstParam(params, "email") ?? "").trim();
  const page = pageParam(params);

  const result = email ? await loadPageData(() => searchUsers({ email, page })) : null;

  const hrefFor = (target: number) => {
    const query = new URLSearchParams({ email });
    if (target > 1) query.set("page", String(target));
    return `/users?${query.toString()}`;
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p>Find a user to see their subscription, devices and active playback.</p>
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
          </div>
        </div>
      </form>

      {result === null ? (
        <p className="muted">Enter an email address, or part of one, to search.</p>
      ) : result.ok ? (
        <div className="card">
          {result.data.items.length === 0 ? (
            <p className="empty">No users match “{email}”.</p>
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
