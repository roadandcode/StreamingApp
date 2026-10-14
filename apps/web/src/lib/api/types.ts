/**
 * Hand-written types for the v1 API contract (docs/architecture/api-contract.md).
 *
 * Keep this file a faithful copy of the contract so it can later be replaced by the generated
 * `@streamingapp/api-contracts` package without touching the rest of the app.
 */

export type Role = "viewer" | "admin";
export type AccountStatus = "active" | "suspended" | "deleted";
export type ContentKind = "course" | "lesson" | "video";
export type AccessTier = "free" | "premium";
export type Platform = "android" | "ios" | "web";
export type BillingProvider = "apple" | "google" | "razorpay" | "fake";
export type DrmSystem = "widevine" | "fairplay" | "playready";
export type SubscriptionStatus =
  | "none"
  | "pending"
  | "active"
  | "grace_period"
  | "billing_retry"
  | "cancelled"
  | "expired"
  | "refunded"
  | "revoked";

export const DRM_SYSTEMS: readonly DrmSystem[] = ["widevine", "fairplay", "playready"];

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  accountStatus: AccountStatus;
  createdAt: string;
}

export interface Tokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface AuthResponse {
  user: User;
  tokens: Tokens;
}

export interface RefreshResponse {
  tokens: Tokens;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ContentSummary {
  id: string;
  kind: ContentKind;
  title: string;
  description: string;
  accessTier: AccessTier;
  thumbnailUrl: string | null;
  /** BCP-47, e.g. "hi", "en". */
  defaultLanguage: string;
  /** e.g. "U", "UA 13+". */
  ageRating: string | null;
  durationSeconds: number | null;
}

export interface ContentDetail extends ContentSummary {
  parentId: string | null;
  /** Lessons of a course, ordered by position. */
  children: ContentSummary[];
  subtitles: { language: string; label: string }[];
  /** Has a ready video asset. */
  playable: boolean;
}

export interface SubscriptionView {
  status: SubscriptionStatus;
  /** The only field clients may use to show "premium unlocked" UI. It is a hint: the API authorizes playback. */
  hasAccess: boolean;
  accessTier: AccessTier | null;
  planCode: string | null;
  provider: BillingProvider | null;
  accessUntil: string | null;
  autoRenewEnabled: boolean;
}

export interface Plan {
  code: string;
  name: string;
  /** ISO-8601 duration. */
  billingPeriod: "P1M" | "P1Y";
  accessTier: AccessTier;
  storeProducts: { provider: BillingProvider; productId: string }[];
}

export interface Device {
  id: string;
  installationId: string;
  platform: Platform;
  name: string;
  lastSeenAt: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface DrmConfig {
  system: DrmSystem;
  licenseUrl: string;
  /** FairPlay application certificate. */
  certificateUrl: string | null;
  /**
   * Headers the player must send on every license request, exactly as given. They carry the
   * short-lived license token; names are vendor-specific, so never hardcode them. Never log them.
   */
  licenseRequestHeaders: Record<string, string>;
}

export interface PlaybackAuthorization {
  playbackSessionId: string;
  contentId: string;
  /** Short-lived; never a permanent public URL. Never log it. */
  manifestUrl: string;
  /** Playback authorization expiry, extended by heartbeats. */
  expiresAt: string;
  heartbeatIntervalSeconds: number;
  drm: DrmConfig | null;
}

export interface HeartbeatResponse {
  expiresAt: string;
}

export interface RazorpaySubscriptionCreated {
  razorpaySubscriptionId: string;
  keyId: string;
  planCode: string;
}

export interface RazorpayVerifyRequest {
  razorpaySubscriptionId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface PurchaseVerifyRequest {
  provider: BillingProvider;
  productId: string;
  receipt: string;
}

/** Stable error codes from the contract's error table. */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_PURCHASE"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "INVALID_REFRESH_TOKEN"
  | "INVALID_SIGNATURE"
  | "FORBIDDEN"
  | "ACCOUNT_INACTIVE"
  | "ENTITLEMENT_REQUIRED"
  | "REGION_NOT_ALLOWED"
  | "CONTENT_NOT_PLAYABLE"
  | "DEVICE_NOT_REGISTERED"
  | "DEVICE_REVOKED"
  | "CONCURRENT_STREAM_LIMIT"
  | "PLAYBACK_SESSION_ENDED"
  | "NOT_FOUND"
  | "EMAIL_TAKEN"
  | "DEVICE_LIMIT_REACHED"
  | "PURCHASE_BELONGS_TO_OTHER_ACCOUNT"
  | "ASSET_NOT_READY"
  | "RATE_LIMITED"
  | "PROVIDER_NOT_CONFIGURED";

/** Field-level detail carried by `400 VALIDATION_FAILED` (e.g. `field: "password"`). */
export interface FieldError {
  field: string;
  message: string;
}

/** The error body every API error response carries. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  /** Only on `400 VALIDATION_FAILED`. */
  errors?: FieldError[];
}
