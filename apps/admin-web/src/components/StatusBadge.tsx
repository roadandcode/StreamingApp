import type {
  AccountStatus,
  ProcessingStatus,
  PublicationStatus,
  SubscriptionStatus,
} from "@/lib/api/types";
import { humanize } from "@/lib/format";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "badge",
  success: "badge badge-success",
  warning: "badge badge-warning",
  danger: "badge badge-danger",
  info: "badge badge-info",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={toneClass[tone]}>{children}</span>;
}

const publicationTone: Record<PublicationStatus, Tone> = {
  draft: "neutral",
  published: "success",
  unpublished: "warning",
};

export function PublicationBadge({ status }: { status: PublicationStatus }) {
  return <Badge tone={publicationTone[status]}>{humanize(status)}</Badge>;
}

const processingTone: Record<ProcessingStatus, Tone> = {
  awaiting_upload: "neutral",
  processing: "info",
  ready: "success",
  failed: "danger",
};

export function ProcessingBadge({ status }: { status: ProcessingStatus | null }) {
  if (status === null) {
    return <Badge>No video</Badge>;
  }
  return <Badge tone={processingTone[status]}>{humanize(status)}</Badge>;
}

const subscriptionTone: Record<SubscriptionStatus, Tone> = {
  none: "neutral",
  pending: "info",
  active: "success",
  grace_period: "warning",
  billing_retry: "warning",
  cancelled: "warning",
  expired: "neutral",
  refunded: "danger",
  revoked: "danger",
};

export function SubscriptionBadge({ status }: { status: SubscriptionStatus }) {
  return <Badge tone={subscriptionTone[status]}>{humanize(status)}</Badge>;
}

const accountTone: Record<AccountStatus, Tone> = {
  active: "success",
  suspended: "warning",
  deleted: "danger",
};

export function AccountBadge({ status }: { status: AccountStatus }) {
  return <Badge tone={accountTone[status]}>{humanize(status)}</Badge>;
}
