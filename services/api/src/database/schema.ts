import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** All timestamps are `timestamptz` and are read/written as JS `Date` (UTC). */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const roleEnum = pgEnum('role', ['viewer', 'admin']);
export const accountStatusEnum = pgEnum('account_status', ['active', 'suspended', 'deleted']);
export const contentKindEnum = pgEnum('content_kind', ['course', 'lesson', 'video']);
export const accessTierEnum = pgEnum('access_tier', ['free', 'premium']);
export const publicationStatusEnum = pgEnum('publication_status', [
  'draft',
  'published',
  'unpublished',
]);
export const processingStatusEnum = pgEnum('processing_status', [
  'awaiting_upload',
  'processing',
  'ready',
  'failed',
]);
export const platformEnum = pgEnum('platform', ['android', 'ios', 'web']);
export const billingProviderEnum = pgEnum('billing_provider', ['apple', 'google', 'razorpay', 'fake']);
export const billingPeriodEnum = pgEnum('billing_period', ['P1M', 'P1Y']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'pending',
  'active',
  'grace_period',
  'billing_retry',
  'cancelled',
  'expired',
  'refunded',
  'revoked',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Always stored lowercased and trimmed. */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  role: roleEnum('role').notNull().default('viewer'),
  accountStatus: accountStatusEnum('account_status').notNull().default('active'),
  emailVerifiedAt: ts('email_verified_at'),
  deletedAt: ts('deleted_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * One row per issued refresh token. Rotation inserts a new row in the same `family_id` and stamps
 * `rotated_at` on the old one; reuse of a rotated token revokes the whole family.
 */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    rotatedAt: ts('rotated_at'),
    createdAt: createdAt(),
  },
  (t) => [index('user_sessions_user_id_idx').on(t.userId), index('user_sessions_family_id_idx').on(t.familyId)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    installationId: text('installation_id').notNull(),
    platform: platformEnum('platform').notNull(),
    name: text('name').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    /**
     * Who revoked the device: `user` (removed by its owner; re-registering re-activates it),
     * `admin` (blocked permanently) or `account_deletion`.
     */
    revokedBy: text('revoked_by').$type<DeviceRevokedBy>(),
    riskStatus: text('risk_status').notNull().default('normal'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('devices_user_installation_uq').on(t.userId, t.installationId)],
);

export const content = pgTable(
  'content',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: contentKindEnum('kind').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => content.id, { onDelete: 'restrict' }),
    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    accessTier: accessTierEnum('access_tier').notNull(),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('draft'),
    ageRating: text('age_rating'),
    defaultLanguage: text('default_language').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    durationSeconds: integer('duration_seconds'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('content_parent_position_idx').on(t.parentId, t.position),
    index('content_publication_status_idx').on(t.publicationStatus),
  ],
);

export const videoAssets = pgTable(
  'video_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAssetId: text('provider_asset_id').notNull().unique(),
    processingStatus: processingStatusEnum('processing_status').notNull().default('awaiting_upload'),
    drmProfile: text('drm_profile'),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('video_assets_content_id_idx').on(t.contentId, t.createdAt)],
);

export const subtitles = pgTable(
  'subtitles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    label: text('label').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('subtitles_content_language_uq').on(t.contentId, t.language)],
);

export const contentRegions = pgTable(
  'content_regions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    /** ISO-3166 alpha-2, uppercase. */
    countryCode: char('country_code', { length: 2 }).notNull(),
    availableFrom: ts('available_from'),
    availableUntil: ts('available_until'),
  },
  (t) => [uniqueIndex('content_regions_content_country_uq').on(t.contentId, t.countryCode)],
);

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  billingPeriod: billingPeriodEnum('billing_period').notNull(),
  accessTier: accessTierEnum('access_tier').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const storeProducts = pgTable(
  'store_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: billingProviderEnum('provider').notNull(),
    productId: text('product_id').notNull(),
    storefront: text('storefront').notNull().default('default'),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('store_products_provider_product_storefront_uq').on(t.provider, t.productId, t.storefront)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    provider: billingProviderEnum('provider').notNull(),
    /** Apple original transaction id, Google purchase token or Razorpay subscription id. */
    providerSubscriptionId: text('provider_subscription_id').notNull(),
    status: subscriptionStatusEnum('status').notNull(),
    currentPeriodEnd: ts('current_period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    autoRenew: boolean('auto_renew').notNull().default(true),
    lastVerifiedAt: ts('last_verified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('subscriptions_provider_subscription_uq').on(t.provider, t.providerSubscriptionId),
    index('subscriptions_user_status_idx').on(t.userId, t.status),
  ],
);

export const billingTransactions = pgTable(
  'billing_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    provider: billingProviderEnum('provider').notNull(),
    providerTransactionId: text('provider_transaction_id').notNull(),
    originalTransactionId: text('original_transaction_id').notNull(),
    /** ISO-4217, e.g. INR. Null when the provider does not report it. */
    currency: char('currency', { length: 3 }),
    grossAmountMinor: bigint('gross_amount_minor', { mode: 'number' }),
    taxAmountMinor: bigint('tax_amount_minor', { mode: 'number' }),
    refundStatus: text('refund_status').notNull().default('none'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('billing_transactions_provider_transaction_uq').on(t.provider, t.providerTransactionId),
    index('billing_transactions_subscription_idx').on(t.subscriptionId),
  ],
);

/** One normalized entitlement row per user, recomputed from their subscriptions. */
export const entitlements = pgTable(
  'entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    accessTier: accessTierEnum('access_tier').notNull(),
    validFrom: ts('valid_from').notNull(),
    validUntil: ts('valid_until').notNull(),
    sourceSubscriptionId: uuid('source_subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('entitlements_user_uq').on(t.userId)],
);

export const playbackSessions = pgTable(
  'playback_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    startedAt: ts('started_at').notNull().defaultNow(),
    lastHeartbeatAt: ts('last_heartbeat_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    lastPositionSeconds: integer('last_position_seconds').notNull().default(0),
    endedAt: ts('ended_at'),
    revokedAt: ts('revoked_at'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    index('playback_sessions_active_by_user_idx')
      .on(t.userId, t.lastHeartbeatAt)
      .where(sql`${t.endedAt} is null and ${t.revokedAt} is null`),
    index('playback_sessions_device_idx').on(t.deviceId),
  ],
);

export const providerEvents = pgTable(
  'provider_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: billingProviderEnum('provider').notNull(),
    eventId: text('event_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
    /** received | processed | skipped | failed */
    processingStatus: text('processing_status').notNull().default('received'),
    error: text('error'),
  },
  (t) => [uniqueIndex('provider_events_provider_event_uq').on(t.provider, t.eventId)],
);

export const drmLicenseAudit = pgTable(
  'drm_license_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playbackSessionId: uuid('playback_session_id')
      .notNull()
      .references(() => playbackSessions.id, { onDelete: 'cascade' }),
    system: text('system').notNull(),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    outcome: text('outcome').notNull(),
  },
  (t) => [index('drm_license_audit_session_idx').on(t.playbackSessionId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
    index('audit_logs_created_at_idx').on(t.createdAt),
  ],
);

export type DeviceRevokedBy = 'user' | 'admin' | 'account_deletion';

export type UserRow = typeof users.$inferSelect;
export type UserSessionRow = typeof userSessions.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type ContentRow = typeof content.$inferSelect;
export type VideoAssetRow = typeof videoAssets.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type EntitlementRow = typeof entitlements.$inferSelect;
export type PlaybackSessionRow = typeof playbackSessions.$inferSelect;

export type Role = (typeof roleEnum.enumValues)[number];
export type AccountStatus = (typeof accountStatusEnum.enumValues)[number];
export type ContentKind = (typeof contentKindEnum.enumValues)[number];
export type AccessTier = (typeof accessTierEnum.enumValues)[number];
export type PublicationStatus = (typeof publicationStatusEnum.enumValues)[number];
export type ProcessingStatus = (typeof processingStatusEnum.enumValues)[number];
export type Platform = (typeof platformEnum.enumValues)[number];
export type BillingProvider = (typeof billingProviderEnum.enumValues)[number];
export type BillingPeriod = (typeof billingPeriodEnum.enumValues)[number];
export type StoredSubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number];
