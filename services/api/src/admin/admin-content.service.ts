import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { toContentSummary } from '../catalog/catalog.dto';
import { AppException } from '../common/errors';
import { toPageRequest } from '../common/pagination';
import { type Database, DRIZZLE, type Executor } from '../database/database.types';
import { content, type ContentKind, type ContentRow, contentRegions, videoAssets } from '../database/schema';
import { MEDIA_PROVIDER, type MediaProvider } from '../media/media-provider';
import type {
  AdminContentDetailDto,
  AdminContentDto,
  AdminContentQueryDto,
  CreateContentDto,
  PaginatedAdminContentDto,
  UpdateContentDto,
  UploadSessionDto,
} from './admin-content.dto';

/** Kinds that carry a video; courses are containers and publish without one. */
const PLAYABLE_KINDS: ReadonlySet<ContentKind> = new Set(['lesson', 'video']);

@Injectable()
export class AdminContentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(MEDIA_PROVIDER) private readonly media: MediaProvider,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminContentQueryDto): Promise<PaginatedAdminContentDto> {
    const { page, pageSize, offset } = toPageRequest(query);
    const conditions: SQL[] = [];
    if (query.kind) conditions.push(eq(content.kind, query.kind));
    if (query.status) conditions.push(eq(content.publicationStatus, query.status));
    if (query.parentId) conditions.push(eq(content.parentId, query.parentId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(content)
        .where(where)
        .orderBy(desc(content.createdAt), asc(content.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(content).where(where),
    ]);
    return { items: await this.toAdminContent(this.db, rows), page, pageSize, total: totalRow?.total ?? 0 };
  }

  async get(id: string): Promise<AdminContentDetailDto> {
    const row = await this.findOrThrow(this.db, id);
    const children = await this.db
      .select()
      .from(content)
      .where(eq(content.parentId, id))
      .orderBy(asc(content.position), asc(content.createdAt), asc(content.id));
    const [item] = await this.toAdminContent(this.db, [row]);
    if (!item) throw new AppException('NOT_FOUND');
    return { ...item, children: await this.toAdminContent(this.db, children) };
  }

  async create(actorId: string, dto: CreateContentDto): Promise<AdminContentDto> {
    return this.db.transaction(async (tx) => {
      await this.validateHierarchy(tx, { id: null, kind: dto.kind, parentId: dto.parentId ?? null });
      const [row] = await tx
        .insert(content)
        .values({
          kind: dto.kind,
          title: dto.title,
          description: dto.description,
          accessTier: dto.accessTier,
          defaultLanguage: dto.defaultLanguage,
          ageRating: dto.ageRating ?? null,
          parentId: dto.parentId ?? null,
          position: dto.position ?? 0,
          publicationStatus: 'draft',
        })
        .returning();
      if (!row) throw new Error('Content insert returned no row');
      await this.replaceRegions(tx, row.id, dto.regions);
      await this.audit.record(tx, {
        actorUserId: actorId,
        action: 'content.create',
        targetType: 'content',
        targetId: row.id,
        metadata: { kind: row.kind, title: row.title, accessTier: row.accessTier, regions: dto.regions },
      });
      return this.single(tx, row);
    });
  }

  async update(actorId: string, id: string, dto: UpdateContentDto): Promise<AdminContentDto> {
    return this.db.transaction(async (tx) => {
      const existing = await this.findOrThrow(tx, id, true);
      const kind = dto.kind ?? existing.kind;
      const parentId = dto.parentId !== undefined ? dto.parentId : existing.parentId;
      await this.validateHierarchy(tx, { id, kind, parentId });
      if (kind !== 'course' && existing.kind === 'course') {
        const [{ children } = { children: 0 }] = await tx
          .select({ children: count() })
          .from(content)
          .where(eq(content.parentId, id));
        if (children > 0) {
          throw new AppException('VALIDATION_FAILED', 'A course with lessons cannot change its kind.');
        }
      }
      const changes: Partial<typeof content.$inferInsert> = {};
      if (dto.kind !== undefined) changes.kind = dto.kind;
      if (dto.title !== undefined) changes.title = dto.title;
      if (dto.description !== undefined) changes.description = dto.description;
      if (dto.accessTier !== undefined) changes.accessTier = dto.accessTier;
      if (dto.defaultLanguage !== undefined) changes.defaultLanguage = dto.defaultLanguage;
      if (dto.ageRating !== undefined) changes.ageRating = dto.ageRating;
      if (dto.parentId !== undefined) changes.parentId = dto.parentId;
      if (dto.position !== undefined) changes.position = dto.position;

      let row = existing;
      if (Object.keys(changes).length > 0) {
        const [updated] = await tx.update(content).set(changes).where(eq(content.id, id)).returning();
        row = updated ?? existing;
      } else if (dto.regions !== undefined) {
        const [touched] = await tx.update(content).set({ updatedAt: new Date() }).where(eq(content.id, id)).returning();
        row = touched ?? existing;
      }
      if (dto.regions !== undefined) {
        await this.replaceRegions(tx, id, dto.regions);
      }
      await this.audit.record(tx, {
        actorUserId: actorId,
        action: 'content.update',
        targetType: 'content',
        targetId: id,
        metadata: { fields: [...Object.keys(changes), ...(dto.regions !== undefined ? ['regions'] : [])] },
      });
      return this.single(tx, row);
    });
  }

  async createUploadSession(actorId: string, id: string): Promise<UploadSessionDto> {
    const row = await this.findOrThrow(this.db, id);
    if (!PLAYABLE_KINDS.has(row.kind)) {
      throw new AppException('VALIDATION_FAILED', 'Only lessons and videos have a video asset.');
    }
    const session = await this.media.createUploadSession(id);
    return this.db.transaction(async (tx) => {
      const [asset] = await tx
        .insert(videoAssets)
        .values({
          contentId: id,
          provider: this.media.name,
          providerAssetId: session.providerAssetId,
          processingStatus: 'awaiting_upload',
        })
        .returning({ id: videoAssets.id });
      if (!asset) throw new Error('Video asset insert returned no row');
      await this.audit.record(tx, {
        actorUserId: actorId,
        action: 'content.upload_session.create',
        targetType: 'content',
        targetId: id,
        metadata: { videoAssetId: asset.id, provider: this.media.name },
      });
      return {
        videoAssetId: asset.id,
        uploadUrl: session.uploadUrl,
        method: session.method,
        headers: session.headers,
        expiresAt: session.expiresAt.toISOString(),
      };
    });
  }

  /** Lessons and videos need a ready asset (`409 ASSET_NOT_READY`); courses publish without one. */
  async publish(actorId: string, id: string): Promise<AdminContentDto> {
    const existing = await this.findOrThrow(this.db, id);
    if (PLAYABLE_KINDS.has(existing.kind)) {
      await this.refreshAssetStatuses(id);
    }
    return this.db.transaction(async (tx) => {
      const row = await this.findOrThrow(tx, id, true);
      const now = new Date();
      if (PLAYABLE_KINDS.has(row.kind)) {
        const [ready] = await tx
          .select({ id: videoAssets.id })
          .from(videoAssets)
          .where(and(eq(videoAssets.contentId, id), eq(videoAssets.processingStatus, 'ready')))
          .limit(1);
        if (!ready) {
          throw new AppException('ASSET_NOT_READY');
        }
        await tx
          .update(videoAssets)
          .set({ publishedAt: now })
          .where(
            and(eq(videoAssets.contentId, id), eq(videoAssets.processingStatus, 'ready'), isNull(videoAssets.publishedAt)),
          );
      }
      const [updated] = await tx
        .update(content)
        .set({ publicationStatus: 'published' })
        .where(eq(content.id, id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: actorId,
        action: 'content.publish',
        targetType: 'content',
        targetId: id,
        metadata: { previousStatus: row.publicationStatus },
      });
      return this.single(tx, updated ?? row);
    });
  }

  /** Unpublished content disappears from the catalog; open sessions end at their next heartbeat. */
  async unpublish(actorId: string, id: string): Promise<AdminContentDto> {
    return this.db.transaction(async (tx) => {
      const row = await this.findOrThrow(tx, id, true);
      const [updated] = await tx
        .update(content)
        .set({ publicationStatus: 'unpublished' })
        .where(eq(content.id, id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: actorId,
        action: 'content.unpublish',
        targetType: 'content',
        targetId: id,
        metadata: { previousStatus: row.publicationStatus },
      });
      return this.single(tx, updated ?? row);
    });
  }

  /** Asks the media provider about assets that are not ready yet and stores their status. */
  private async refreshAssetStatuses(contentId: string): Promise<void> {
    const pending = await this.db
      .select({ id: videoAssets.id, providerAssetId: videoAssets.providerAssetId })
      .from(videoAssets)
      .where(
        and(
          eq(videoAssets.contentId, contentId),
          inArray(videoAssets.processingStatus, ['awaiting_upload', 'processing']),
          eq(videoAssets.provider, this.media.name),
        ),
      );
    for (const asset of pending) {
      const status = await this.media.getAssetStatus(asset.providerAssetId);
      await this.db.update(videoAssets).set({ processingStatus: status }).where(eq(videoAssets.id, asset.id));
    }
  }

  private async validateHierarchy(
    tx: Executor,
    item: { id: string | null; kind: ContentKind; parentId: string | null },
  ): Promise<void> {
    if (item.kind === 'course') {
      if (item.parentId) throw new AppException('VALIDATION_FAILED', 'A course cannot have a parent.');
      return;
    }
    if (!item.parentId) {
      if (item.kind === 'lesson') throw new AppException('VALIDATION_FAILED', 'A lesson needs a parent course (parentId).');
      return;
    }
    if (item.parentId === item.id) {
      throw new AppException('VALIDATION_FAILED', 'Content cannot be its own parent.');
    }
    const [parent] = await tx.select({ kind: content.kind }).from(content).where(eq(content.id, item.parentId)).limit(1);
    if (!parent || parent.kind !== 'course') {
      throw new AppException('VALIDATION_FAILED', 'parentId must reference an existing course.');
    }
  }

  private async replaceRegions(tx: Executor, contentId: string, regions: string[]): Promise<void> {
    await tx.delete(contentRegions).where(eq(contentRegions.contentId, contentId));
    if (regions.length > 0) {
      await tx.insert(contentRegions).values(regions.map((countryCode) => ({ contentId, countryCode })));
    }
  }

  private async findOrThrow(executor: Executor, id: string, lock = false): Promise<ContentRow> {
    const query = executor.select().from(content).where(eq(content.id, id)).limit(1);
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw new AppException('NOT_FOUND');
    return row;
  }

  private async single(executor: Executor, row: ContentRow): Promise<AdminContentDto> {
    const [item] = await this.toAdminContent(executor, [row]);
    if (!item) throw new AppException('NOT_FOUND');
    return item;
  }

  private async toAdminContent(executor: Executor, rows: ContentRow[]): Promise<AdminContentDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [regionRows, assetRows] = await Promise.all([
      executor
        .select({ contentId: contentRegions.contentId, countryCode: contentRegions.countryCode })
        .from(contentRegions)
        .where(inArray(contentRegions.contentId, ids))
        .orderBy(asc(contentRegions.countryCode)),
      executor
        .selectDistinctOn([videoAssets.contentId], {
          contentId: videoAssets.contentId,
          id: videoAssets.id,
          processingStatus: videoAssets.processingStatus,
        })
        .from(videoAssets)
        .where(inArray(videoAssets.contentId, ids))
        .orderBy(videoAssets.contentId, desc(videoAssets.createdAt)),
    ]);
    const regions = new Map<string, string[]>();
    for (const r of regionRows) regions.set(r.contentId, [...(regions.get(r.contentId) ?? []), r.countryCode]);
    const assets = new Map(assetRows.map((a) => [a.contentId, { id: a.id, processingStatus: a.processingStatus }]));
    return rows.map((row) => ({
      ...toContentSummary(row),
      publicationStatus: row.publicationStatus,
      parentId: row.parentId,
      position: row.position,
      regions: regions.get(row.id) ?? [],
      asset: assets.get(row.id) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}

