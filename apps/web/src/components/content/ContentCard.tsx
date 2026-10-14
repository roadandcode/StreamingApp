import Link from "next/link";
import type { ContentSummary } from "@/lib/api/types";
import { formatDuration, kindLabel } from "@/lib/format";
import { AccessBadge, LockIcon } from "./badges";
import styles from "./ContentCard.module.css";
import { Thumbnail } from "./Thumbnail";

export function ContentCard({ item, locked }: { item: ContentSummary; locked: boolean }) {
  const duration = formatDuration(item.durationSeconds);
  return (
    <Link
      href={`/content/${item.id}`}
      className={styles.card}
      data-testid="content-card"
      data-kind={item.kind}
      data-tier={item.accessTier}
    >
      <div className={styles.media}>
        <Thumbnail src={item.thumbnailUrl} title={item.title} />
        <div className={styles.overlay}>
          <AccessBadge tier={item.accessTier} />
          {locked && item.accessTier === "premium" ? (
            <span className={styles.lock}>
              <LockIcon />
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles.body}>
        <h3 className={styles.title}>{item.title}</h3>
        <p className={styles.meta}>
          {kindLabel(item.kind)}
          {duration ? ` · ${duration}` : ""}
          {item.ageRating ? ` · ${item.ageRating}` : ""}
        </p>
      </div>
    </Link>
  );
}
