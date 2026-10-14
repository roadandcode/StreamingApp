import type { ContentKind, Plan, SubscriptionStatus } from "@/lib/api/types";

export const SITE_NAME = "StreamingApp";
export const SITE_TAGLINE = "Original courses and videos, made in India.";

export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return `${Math.round(seconds)} sec`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function billingPeriodLabel(period: Plan["billingPeriod"]): string {
  return period === "P1Y" ? "Billed yearly" : "Billed monthly";
}

export function billingPeriodShort(period: Plan["billingPeriod"]): string {
  return period === "P1Y" ? "year" : "month";
}

export function kindLabel(kind: ContentKind): string {
  if (kind === "course") return "Course";
  if (kind === "lesson") return "Lesson";
  return "Video";
}

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en-IN"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  none: "No subscription",
  pending: "Payment pending",
  active: "Active",
  grace_period: "Active (payment issue)",
  billing_retry: "Payment failed",
  cancelled: "Cancelled",
  expired: "Expired",
  refunded: "Refunded",
  revoked: "Revoked",
};

export function subscriptionStatusLabel(status: SubscriptionStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** Shortens text for meta descriptions without cutting a word in half. */
export function truncate(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
