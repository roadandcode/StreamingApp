import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, type SQL } from 'drizzle-orm';
import { AppException } from '../common/errors';
import { toPageRequest } from '../common/pagination';
import { type Database, DRIZZLE } from '../database/database.types';
import { content, subtitles } from '../database/schema';
import {
  type CatalogQueryDto,
  type ContentDetailDto,
  type PaginatedContentSummaryDto,
  toContentSummary,
} from './catalog.dto';
import { availableInCountry, loadContentFacts } from './content-visibility';

@Injectable()
export class CatalogService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Published, top-level items available in the viewer's country. */
  async list(query: CatalogQueryDto, country: string): Promise<PaginatedContentSummaryDto> {
    const { page, pageSize, offset } = toPageRequest(query);
    const now = new Date();
    const conditions: SQL[] = [
      eq(content.publicationStatus, 'published'),
      isNull(content.parentId),
      availableInCountry(country, now),
    ];
    if (query.kind) conditions.push(eq(content.kind, query.kind));
    if (query.language) conditions.push(eq(content.defaultLanguage, query.language));
    const where = and(...conditions);

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(content)
        .where(where)
        .orderBy(asc(content.position), asc(content.createdAt), asc(content.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(content).where(where),
    ]);
    return { items: rows.map(toContentSummary), page, pageSize, total: totalRow?.total ?? 0 };
  }

  /** `404` unless published (with a published parent) and available in the viewer's country. */
  async detail(contentId: string, country: string): Promise<ContentDetailDto> {
    const now = new Date();
    const facts = await loadContentFacts(this.db, contentId, country, now);
    if (!facts || !facts.published || !facts.availableInCountry) {
      throw new AppException('NOT_FOUND');
    }
    const [children, subtitleRows] = await Promise.all([
      this.db
        .select()
        .from(content)
        .where(
          and(
            eq(content.parentId, contentId),
            eq(content.publicationStatus, 'published'),
            availableInCountry(country, now),
          ),
        )
        .orderBy(asc(content.position), asc(content.createdAt), asc(content.id)),
      this.db
        .select({ language: subtitles.language, label: subtitles.label })
        .from(subtitles)
        .where(eq(subtitles.contentId, contentId))
        .orderBy(asc(subtitles.language)),
    ]);
    return {
      ...toContentSummary(facts.row),
      parentId: facts.row.parentId,
      children: children.map(toContentSummary),
      subtitles: subtitleRows,
      playable: facts.hasReadyAsset,
    };
  }
}
