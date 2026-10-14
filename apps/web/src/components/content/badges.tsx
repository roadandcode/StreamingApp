import type { AccessTier } from "@/lib/api/types";

export function AccessBadge({ tier }: { tier: AccessTier }) {
  return tier === "free" ? (
    <span className="badge badge-free">Free</span>
  ) : (
    <span className="badge badge-premium">Premium</span>
  );
}

/**
 * Lock shown on premium items the viewer has no access to. It is only a hint: the API authorizes
 * every playback and the player stops on any 403.
 */
export function LockIcon({ label = "Locked: subscription required" }: { label?: string }) {
  return (
    <span role="img" aria-label={label} title={label} data-testid="lock" className="lock-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="10" width="16" height="11" rx="2.5" fill="currentColor" opacity="0.9" />
        <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" />
      </svg>
    </span>
  );
}

export function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
    </svg>
  );
}
