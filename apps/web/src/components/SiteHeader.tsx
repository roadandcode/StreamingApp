import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { SITE_NAME } from "@/lib/format";
import { readSession } from "@/lib/session/server";
import styles from "./SiteHeader.module.css";

/** Reads only the session cookie (no API call), so every page can render it cheaply. */
export async function SiteHeader() {
  const session = await readSession();
  const label = session?.user.displayName || session?.user.email;

  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.logo} aria-label={`${SITE_NAME} home`}>
          <span className={styles.logoMark} aria-hidden="true">
            ▶
          </span>
          <span>{SITE_NAME}</span>
        </Link>

        <nav className={styles.nav} aria-label="Main">
          <Link href="/" className={styles.navLink}>
            Browse
          </Link>
          <Link href="/subscribe" className={styles.navLink}>
            Plans
          </Link>
        </nav>

        <div className={styles.actions}>
          {session ? (
            <>
              <Link href="/account" className={styles.account} data-testid="account-link">
                <span className={styles.avatar} aria-hidden="true">
                  {(label ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className={styles.accountLabel}>{label}</span>
              </Link>
              <form action={signOut}>
                <button type="submit" className="btn btn-ghost btn-small">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-small">
                Sign in
              </Link>
              <Link href="/register" className="btn btn-primary btn-small">
                Join free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
