import Link from "next/link";
import type { ReactNode } from "react";
import styles from "@/components/AppShell.module.css";
import { NavLinks } from "@/components/NavLinks";
import { requireAdminSession } from "@/lib/session/server";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminSession();

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/content" className={styles.brand}>
            StreamingApp <span>Admin</span>
          </Link>
          <NavLinks />
          <div className={styles.account}>
            <span data-testid="signed-in-as">{session.user.email}</span>
            <form method="post" action="/auth/logout">
              <button type="submit" className="btn btn-small">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}
