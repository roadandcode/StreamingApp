import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { ACCESS_TIERS, CONTENT_KINDS } from '../common/enums';
import { PaginationQueryDto } from '../common/pagination';
import type { AccessTier, ContentKind, ContentRow } from '../database/schema';

export const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export class CatalogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CONTENT_KINDS, enumName: 'ContentKind' })
  @IsOptional()
  @IsIn(CONTENT_KINDS)
  kind?: ContentKind;

  @ApiPropertyOptional({ description: 'BCP-47 language tag, e.g. "hi" or "en"', example: 'hi' })
  @IsOptional()
  @Matches(LANGUAGE_TAG_PATTERN, { message: 'language must be a BCP-47 language tag' })
  language?: string;
}

export class ContentSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: CONTENT_KINDS, enumName: 'ContentKind' })
  kind: ContentKind;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: ACCESS_TIERS, enumName: 'AccessTier' })
  accessTier: AccessTier;

  @ApiProperty({ type: String, nullable: true })
  thumbnailUrl: string | null;

  @ApiProperty({ description: 'BCP-47, e.g. "hi", "en"', example: 'hi' })
  defaultLanguage: string;

  @ApiProperty({ type: String, nullable: true, example: 'UA 13+' })
  ageRating: string | null;

  @ApiProperty({ type: Number, nullable: true })
  durationSeconds: number | null;
}

export class SubtitleDto {
  @ApiProperty({ example: 'en' })
  language: string;

  @ApiProperty({ example: 'English' })
  label: string;
}

export class ContentDetailDto extends ContentSummaryDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentId: string | null;

  @ApiProperty({ type: ContentSummaryDto, isArray: true, description: 'Lessons of a course, ordered by position' })
  children: ContentSummaryDto[];

  @ApiProperty({ type: SubtitleDto, isArray: true })
  subtitles: SubtitleDto[];

  @ApiProperty({ description: 'Has a ready video asset' })
  playable: boolean;
}

export class PaginatedContentSummaryDto {
  @ApiProperty({ type: ContentSummaryDto, isArray: true })
  items: ContentSummaryDto[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 57 })
  total: number;
}

export function toContentSummary(row: ContentRow): ContentSummaryDto {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    accessTier: row.accessTier,
    thumbnailUrl: row.thumbnailUrl,
    defaultLanguage: row.defaultLanguage,
    ageRating: row.ageRating,
    durationSeconds: row.durationSeconds,
  };
}
