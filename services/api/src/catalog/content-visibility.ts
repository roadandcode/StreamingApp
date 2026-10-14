import { and, desc, eq, exists, gt, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { Executor } from '../database/database.types';
import { content, type ContentRow, contentRegions, type VideoAssetRow, videoAssets } from '../database/schema';

/** SQL condition: the `content` row in scope is licensed for `country` at `now`. */
export function availableInCountry(country: string, now: Date): SQL {
  return exists(
    sql`(select 1 from ${contentRegions} where ${and(
      eq(contentRegions.contentId, content.id),
      eq(contentRegions.countryCode, country),
      or(isNull(contentRegions.availableFrom), lte(contentRegions.availableFrom, now)),
      or(isNull(contentRegions.availableUntil), gt(contentRegions.availableUntil, now)),
    )})`,
  );
}

/** SQL condition: the `content` row in scope has a video asset in `ready` state. */
export function hasReadyAsset(): SQL {
  return exists(
    sql`(select 1 from ${videoAssets} where ${and(
      eq(videoAssets.contentId, content.id),
      eq(videoAssets.processingStatus, 'ready'),
    )})`,
  );
}

export interface ContentFacts {
  row: ContentRow;
  /** Published, and its parent course (if any) is published too. */
  published: boolean;
  availableInCountry: boolean;
  hasReadyAsset: boolean;
}

/** Everything the catalog and the playback checks need to know about one item. */
export async function loadContentFacts(
  db: Executor,
  contentId: string,
  country: string,
  now: Date,
): Promise<ContentFacts | null> {
  const [result] = await db
    .select({
      row: content,
      availableInCountry: availableInCountry(country, now).mapWith(Boolean),
      hasReadyAsset: hasReadyAsset().mapWith(Boolean),
    })
    .from(content)
    .where(eq(content.id, contentId))
    .limit(1);
  if (!result) return null;
  let published = result.row.publicationStatus === 'published';
  if (published && result.row.parentId) {
    const [parent] = await db
      .select({ status: content.publicationStatus })
      .from(content)
      .where(eq(content.id, result.row.parentId))
      .limit(1);
    published = parent?.status === 'published';
  }
  return {
    row: result.row,
    published,
    availableInCountry: result.availableInCountry,
    hasReadyAsset: result.hasReadyAsset,
  };
}

/** The newest ready asset of a content item, used for playback. */
export async function findReadyAsset(db: Executor, contentId: string): Promise<VideoAssetRow | null> {
  const [asset] = await db
    .select()
    .from(videoAssets)
    .where(and(eq(videoAssets.contentId, contentId), eq(videoAssets.processingStatus, 'ready')))
    .orderBy(desc(videoAssets.createdAt))
    .limit(1);
  return asset ?? null;
}
