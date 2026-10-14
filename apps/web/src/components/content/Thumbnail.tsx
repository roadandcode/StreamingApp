import styles from "./Thumbnail.module.css";

const GRADIENTS = [
  ["#ff7a1a", "#8a2be2"],
  ["#00a2ff", "#1de9b6"],
  ["#ff3d6e", "#ffb347"],
  ["#6a5cff", "#00d4ff"],
  ["#14b37d", "#f4c152"],
  ["#ff5c00", "#ff3d6e"],
];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 16:9 thumbnail; falls back to a generated gradient tile when the item has no image. */
export function Thumbnail({
  src,
  title,
  priority = false,
  className,
}: {
  src: string | null;
  title: string;
  priority?: boolean;
  className?: string;
}) {
  if (src) {
    return (
      <div className={`${styles.frame} ${className ?? ""}`}>
        <img
          src={src}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className={styles.image}
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }
  const [from, to] = GRADIENTS[hash(title) % GRADIENTS.length]!;
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  return (
    <div className={`${styles.frame} ${className ?? ""}`}>
      <svg className={styles.image} viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id={`g${hash(title)}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <rect width="160" height="90" fill={`url(#g${hash(title)})`} />
        <text x="12" y="78" fill="rgba(0,0,0,0.35)" fontSize="44" fontWeight="800" fontFamily="system-ui, sans-serif">
          {initials}
        </text>
      </svg>
    </div>
  );
}
