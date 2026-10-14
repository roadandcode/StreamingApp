import Link from "next/link";
import { SITE_NAME } from "@/lib/format";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <p className={styles.brand}>
          <strong>{SITE_NAME}</strong>
          <span className="muted"> · Original courses and videos. One subscription for web and Android.</span>
        </p>
        <nav className={styles.links} aria-label="Footer">
          <Link href="/">Browse</Link>
          <Link href="/subscribe">Plans</Link>
          <Link href="/account">Account</Link>
        </nav>
      </div>
    </footer>
  );
}
