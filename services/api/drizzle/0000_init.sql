CREATE TYPE "public"."access_tier" AS ENUM('free', 'premium');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."billing_period" AS ENUM('P1M', 'P1Y');--> statement-breakpoint
CREATE TYPE "public"."billing_provider" AS ENUM('apple', 'google', 'fake');--> statement-breakpoint
CREATE TYPE "public"."content_kind" AS ENUM('course', 'lesson', 'video');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('android', 'ios', 'web');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('awaiting_upload', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('draft', 'published', 'unpublished');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('viewer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending', 'active', 'grace_period', 'billing_retry', 'cancelled', 'expired', 'refunded', 'revoked');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"original_transaction_id" text NOT NULL,
	"currency" char(3),
	"gross_amount_minor" bigint,
	"tax_amount_minor" bigint,
	"refund_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "content_kind" NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"access_tier" "access_tier" NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"age_rating" text,
	"default_language" text NOT NULL,
	"thumbnail_url" text,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"available_from" timestamp with time zone,
	"available_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"name" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"risk_status" text DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drm_license_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playback_session_id" uuid NOT NULL,
	"system" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"access_tier" "access_tier" NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"source_subscription_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"billing_period" "billing_period" NOT NULL,
	"access_tier" "access_tier" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "playback_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_position_seconds" integer DEFAULT 0 NOT NULL,
	"ended_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "store_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"product_id" text NOT NULL,
	"storefront" text DEFAULT 'default' NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subtitles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"language" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"account_status" "account_status" DEFAULT 'active' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "video_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_asset_id" text NOT NULL,
	"processing_status" "processing_status" DEFAULT 'awaiting_upload' NOT NULL,
	"drm_profile" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_assets_provider_asset_id_unique" UNIQUE("provider_asset_id")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_parent_id_content_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_regions" ADD CONSTRAINT "content_regions_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drm_license_audit" ADD CONSTRAINT "drm_license_audit_playback_session_id_playback_sessions_id_fk" FOREIGN KEY ("playback_session_id") REFERENCES "public"."playback_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_source_subscription_id_subscriptions_id_fk" FOREIGN KEY ("source_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitles" ADD CONSTRAINT "subtitles_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_transactions_provider_transaction_uq" ON "billing_transactions" USING btree ("provider","provider_transaction_id");--> statement-breakpoint
CREATE INDEX "billing_transactions_subscription_idx" ON "billing_transactions" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "content_parent_position_idx" ON "content" USING btree ("parent_id","position");--> statement-breakpoint
CREATE INDEX "content_publication_status_idx" ON "content" USING btree ("publication_status");--> statement-breakpoint
CREATE UNIQUE INDEX "content_regions_content_country_uq" ON "content_regions" USING btree ("content_id","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_installation_uq" ON "devices" USING btree ("user_id","installation_id");--> statement-breakpoint
CREATE INDEX "drm_license_audit_session_idx" ON "drm_license_audit" USING btree ("playback_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_user_uq" ON "entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "playback_sessions_active_by_user_idx" ON "playback_sessions" USING btree ("user_id","last_heartbeat_at") WHERE "playback_sessions"."ended_at" is null and "playback_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "playback_sessions_device_idx" ON "playback_sessions" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_provider_event_uq" ON "provider_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_products_provider_product_storefront_uq" ON "store_products" USING btree ("provider","product_id","storefront");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_subscription_uq" ON "subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "subtitles_content_language_uq" ON "subtitles" USING btree ("content_id","language");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_family_id_idx" ON "user_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "video_assets_content_id_idx" ON "video_assets" USING btree ("content_id","created_at");