DROP INDEX "video_assets_content_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "video_assets_content_uq" ON "video_assets" USING btree ("content_id");