/**
 * Hand-written copy of the v1 API contract (docs/architecture/api-contract.md).
 *
 * Everything the dashboard needs from the contract lives in this one file so it can be swapped for
 * the generated `@streamingapp/api-contracts` package later without touching the rest of the app.
 */

// ---------------------------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------------------------

export type Role = "viewer" | "admin";
export type AccountStatus = "active" | "suspended" | "deleted";
/** `course` is a container of lessons. */
export type ContentKind = "course" | "lesson" | "video";
export type AccessTier = "free" | "premium";
export type PublicationStatus = "draft" | "published" | "unpublished";
export type ProcessingStatus = "awaiting_upload" | "processing" | "ready" | "failed";
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

export const CONTENT_KINDS: readonly ContentKind[] = ["course", "lesson", "video"];
export const ACCESS_TIERS: readonly AccessTier[] = ["free", "premium"];
export const PUBLICATION_STATUSES: readonly PublicationStatus[] = ["draft", "published", "unpublished"];

// ---------------------------------------------------------------------------------------------
// Shared models
// ---------------------------------------------------------------------------------------------

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
  /** The only field clients may use to show "premium unlocked" UI. */
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

export interface PlaybackAuthorization {
  playbackSessionId: string;
  contentId: string;
  manifestUrl: string;
  expiresAt: string;
  heartbeatIntervalSeconds: number;
  drm: null | {
    system: DrmSystem;
    licenseUrl: string;
    certificateUrl: string | null;
    /** Sent exactly as given on every license request; secret values. */
    licenseRequestHeaders: Record<string, string>;
  };
}

export interface VideoAssetRef {
  id: string;
  processingStatus: ProcessingStatus;
}

export interface AdminContent extends ContentSummary {
  publicationStatus: PublicationStatus;
  parentId: string | null;
  position: number;
  /** ISO-3166 alpha-2, e.g. ["IN"]. */
  regions: string[];
  asset: VideoAssetRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

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

/** One invalid request field; `field` is its path, e.g. "title" or "regions.0". */
export interface FieldError {
  field: string;
  message: string;
}

/** Body of every error response. */
export interface ApiErrorBody {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  /** Present on 400 VALIDATION_FAILED. */
  errors?: FieldError[];
}

// ---------------------------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------------------------

/** POST /v1/auth/login */
export interface LoginRequest {
  email: string;
  password: string;
}

/** 200 from POST /v1/auth/login (and 201 from POST /v1/auth/register). */
export interface AuthResponse {
  user: User;
  tokens: Tokens;
}

/** POST /v1/auth/refresh and POST /v1/auth/logout */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/** 200 from POST /v1/auth/refresh */
export interface RefreshResponse {
  tokens: Tokens;
}

// ---------------------------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------------------------

/**
 * Query of GET /v1/admin/content. Without `parentId` it lists top-level items (courses and
 * standalone videos), newest `updatedAt` first; with `parentId`, that item's children by position.
 */
export interface AdminContentListQuery {
  kind?: ContentKind;
  status?: PublicationStatus;
  parentId?: string;
  page?: number;
  pageSize?: number;
}

/** Body of POST /v1/admin/content */
export interface CreateContentRequest {
  kind: ContentKind;
  title: string;
  description: string;
  accessTier: AccessTier;
  defaultLanguage: string;
  ageRating?: string | null;
  thumbnailUrl?: string | null;
  parentId?: string;
  /** 0-based among siblings; omitted puts the item last. */
  position?: number;
  regions: string[];
}

/**
 * Body of PATCH /v1/admin/content/:id. `kind` and `parentId` cannot change (the API answers 400 if
 * they are sent); `null` clears `ageRating` and `thumbnailUrl`.
 */
export type UpdateContentRequest = Partial<
  Pick<
    CreateContentRequest,
    "title" | "description" | "accessTier" | "defaultLanguage" | "ageRating" | "thumbnailUrl" | "position" | "regions"
  >
>;

/** 200 from GET /v1/admin/content/:id */
export type AdminContentWithChildren = AdminContent & { children: AdminContent[] };

/**
 * 201 from POST /v1/admin/content/:id/upload-session (400 for a course). The file is PUT to
 * `uploadUrl` with `headers` exactly as given (possibly none); success is 204.
 */
export interface UploadSession {
  videoAssetId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

/** Item of GET /v1/admin/users */
export interface AdminUserListItem {
  user: User;
  subscription: SubscriptionView;
}

/** Query of GET /v1/admin/users. Without `email` it lists everyone, newest first. */
export interface AdminUserListQuery {
  /** Case-insensitive substring. */
  email?: string;
  page?: number;
  pageSize?: number;
}

export interface ActivePlaybackSession {
  id: string;
  contentId: string;
  contentTitle: string;
  deviceId: string;
  startedAt: string;
  lastHeartbeatAt: string;
}

/** 200 from GET /v1/admin/users/:id */
export interface AdminUserDetail {
  user: User;
  subscription: SubscriptionView;
  /** Includes revoked devices. */
  devices: Device[];
  activePlaybackSessions: ActivePlaybackSession[];
}
