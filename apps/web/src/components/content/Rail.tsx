import type { ContentSummary } from "@/lib/api/types";
import { ContentCard } from "./ContentCard";
import styles from "./Rail.module.css";

/** A titled, horizontally scrolling row of content cards. */
export function Rail({
  title,
  items,
  hasAccess,
  id,
}: {
  title: string;
  items: ContentSummary[];
  hasAccess: boolean;
  id?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className={styles.rail} aria-labelledby={id ? `${id}-title` : undefined} data-testid="rail">
      <h2 className={styles.title} id={id ? `${id}-title` : undefined}>
        {title}
      </h2>
      <div className={styles.track}>
        {items.map((item) => (
          <ContentCard key={item.id} item={item} locked={!hasAccess} />
        ))}
      </div>
    </section>
  );
}
