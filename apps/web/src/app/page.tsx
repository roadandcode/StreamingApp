import type { Metadata } from "next";
import Link from "next/link";
import { AccessBadge, PlayIcon } from "@/components/content/badges";
import { Rail } from "@/components/content/Rail";
import { Thumbnail } from "@/components/content/Thumbnail";
import type { ContentSummary } from "@/lib/api/types";
import { SITE_NAME, formatDuration, kindLabel, truncate } from "@/lib/format";
import { getCatalog, getViewerAccess } from "@/lib/viewer";
import styles from "./page.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    title: `${SITE_NAME} – original courses and videos`,
    description: "Start with free lessons. Subscribe once to watch everything on the web and on Android.",
    url: "/",
  },
};

const NOTICES: Record<string, string> = {
  "account-deleted": "Your account has been deleted and you have been signed out.",
};

function pickHero(items: ContentSummary[]): ContentSummary | undefined {
  return items.find((item) => item.kind === "course" && item.thumbnailUrl) ?? items.find((i) => i.kind === "course") ?? items[0];
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const { notice } = await searchParams;
  const noticeText = typeof notice === "string" ? NOTICES[notice] : undefined;

  const [catalogResult, access] = await Promise.all([
    getCatalog().then(
      (items) => ({ ok: true as const, items }),
      () => ({ ok: false as const, items: [] as ContentSummary[] }),
    ),
    getViewerAccess(),
  ]);
  const items = catalogResult.items;
  const hero = pickHero(items);
  const courses = items.filter((item) => item.kind === "course");
  const videos = items.filter((item) => item.kind !== "course");
  const free = items.filter((item) => item.accessTier === "free");

  return (
    <>
      {hero ? (
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroBackdrop} aria-hidden="true">
            <Thumbnail src={hero.thumbnailUrl} title={hero.title} priority className={styles.heroImage} />
          </div>
          <div className={`container ${styles.heroContent}`}>
            {noticeText ? <p className="alert alert-success">{noticeText}</p> : null}
            <p className={styles.eyebrow}>
              <AccessBadge tier={hero.accessTier} />
              <span>
                {kindLabel(hero.kind)}
                {formatDuration(hero.durationSeconds) ? ` · ${formatDuration(hero.durationSeconds)}` : ""}
              </span>
            </p>
            <h1 id="hero-title" className={styles.heroTitle}>
              {hero.title}
            </h1>
            <p className={styles.heroText}>{truncate(hero.description, 220)}</p>
            <div className={styles.heroActions}>
              <Link href={`/content/${hero.id}`} className="btn btn-primary">
                <PlayIcon /> {hero.kind === "course" ? "View course" : "Watch now"}
              </Link>
              {!access.hasAccess ? (
                <Link href="/subscribe" className="btn btn-secondary">
                  Subscribe to unlock everything
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section className={`container ${styles.emptyHero}`}>
          {noticeText ? <p className="alert alert-success">{noticeText}</p> : null}
          <h1>{SITE_NAME}</h1>
          <p className="muted">
            {catalogResult.ok
              ? "New courses and videos are on their way. Check back soon."
              : "The catalog is unavailable right now. Please try again in a moment."}
          </p>
        </section>
      )}

      <div className="container">
        <ul className={styles.perks} aria-label="Why subscribe">
          <li>
            <strong>Free lessons</strong>
            <span>Start every course for free, no card needed.</span>
          </li>
          <li>
            <strong>One subscription</strong>
            <span>Unlocks the website and the Android app.</span>
          </li>
          <li>
            <strong>Made in India</strong>
            <span>Original courses in Hindi, English and more.</span>
          </li>
        </ul>

        <Rail id="courses" title="Courses" items={courses} hasAccess={access.hasAccess} />
        <Rail id="videos" title="Videos" items={videos} hasAccess={access.hasAccess} />
        <Rail id="free" title="Free to watch" items={free} hasAccess={access.hasAccess} />

        {!access.hasAccess && items.length > 0 ? (
          <section className={styles.cta} aria-labelledby="cta-title">
            <div>
              <h2 id="cta-title">Unlock every premium lesson</h2>
              <p className="muted">
                Subscribe on the web with UPI, cards or netbanking. Your subscription works on Android too.
              </p>
            </div>
            <Link href="/subscribe" className="btn btn-primary">
              See plans
            </Link>
          </section>
        ) : null}
      </div>
    </>
  );
}
