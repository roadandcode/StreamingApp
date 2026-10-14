import Link from "next/link";
import styles from "./login/login.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.brand}>StreamingApp</p>
        <h1 className={styles.title}>Not found</h1>
        <p>This page or item does not exist, or it has been removed.</p>
        <div className="actions">
          <Link href="/content" className="btn btn-primary">
            Go to content
          </Link>
          <Link href="/users" className="btn">
            Go to users
          </Link>
        </div>
      </div>
    </main>
  );
}
