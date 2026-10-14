import styles from "./AuthShell.module.css";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className={`container ${styles.wrap}`}>
      <div className={`panel ${styles.card}`}>
        <h1 className={styles.title}>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
