import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { LANGUAGE_TAG_PATTERN, ContentSummaryDto } from '../catalog/catalog.dto';
import { ACCESS_TIERS, CONTENT_KINDS, PROCESSING_STATUSES, PUBLICATION_STATUSES } from '../common/enums';
import { PaginationQueryDto } from '../common/pagination';
import { EachElement } from '../common/validation';
import type { AccessTier, ContentKind, ProcessingStatus, PublicationStatus } from '../database/schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upperList = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
    : value;

/** Validation shared by create and update; on update a field is only checked when it is sent. */
const TitleRules = () => applyDecorators(Transform(trim), IsString(), IsNotEmpty(), MaxLength(200));
const DescriptionRules = () => applyDecorators(IsString(), MaxLength(5000));
const AccessTierRules = () => applyDecorators(IsIn(ACCESS_TIERS));
const LanguageRules = () =>
  applyDecorators(Matches(LANGUAGE_TAG_PATTERN, { message: 'defaultLanguage must be a BCP-47 language tag' }));
const AgeRatingRules = () => applyDecorators(Transform(trim), IsString(), IsNotEmpty(), MaxLength(20));
const ThumbnailRules = () =>
  applyDecorators(
    IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'thumbnailUrl must be an http(s) URL' }),
    MaxLength(2000),
  );
const PositionRules = () => applyDecorators(IsInt(), Min(0), Max(100_000));
const RegionsRules = () =>
  applyDecorators(
    Transform(upperList),
    IsArray(),
    ArrayMaxSize(250),
    ArrayUnique(),
    EachElement('isCountryCode', (v) => typeof v === 'string' && /^[A-Z]{2}$/.test(v), 'an ISO-3166 alpha-2 country code'),
  );
/** Optional, but not nullable: `null` is rejected. */
const IfSent = () => ValidateIf((_object: object, value: unknown) => value !== undefined);

export class AdminContentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CONTENT_KINDS, enumName: 'ContentKind' })
  @IsOptional()
  @IsIn(CONTENT_KINDS)
  kind?: ContentKind;

  @ApiPropertyOptional({ enum: PUBLICATION_STATUSES, enumName: 'PublicationStatus' })
  @IsOptional()
  @IsIn(PUBLICATION_STATUSES)
  status?: PublicationStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Children of this item, by position. Without it, top-level items (courses and standalone videos), ' +
      'newest updatedAt first.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class CreateContentDto {
  @ApiProperty({ enum: CONTENT_KINDS, enumName: 'ContentKind' })
  @IsIn(CONTENT_KINDS)
  kind: ContentKind;

  @ApiProperty({ maxLength: 200 })
  @TitleRules()
  title: string;

  @ApiProperty({ maxLength: 5000 })
  @DescriptionRules()
  description: string;

  @ApiProperty({ enum: ACCESS_TIERS, enumName: 'AccessTier' })
  @AccessTierRules()
  accessTier: AccessTier;

  @ApiProperty({ description: 'BCP-47 language tag', example: 'hi' })
  @LanguageRules()
  defaultLanguage: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20, example: 'UA 13+' })
  @IsOptional()
  @AgeRatingRules()
  ageRating?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, example: 'https://cdn.example.com/t.jpg' })
  @IsOptional()
  @ThumbnailRules()
  thumbnailUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Parent course. Required for lessons; courses cannot have a parent.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ minimum: 0, description: '0-based order among siblings; omitted puts the item last' })
  @IsOptional()
  @PositionRules()
  position?: number;

  @ApiProperty({ type: String, isArray: true, example: ['IN'], description: 'ISO-3166 alpha-2 country codes' })
  @RegionsRules()
  regions: string[];
}

/** PATCH body: `kind` and `parentId` cannot change; `null` clears `ageRating` and `thumbnailUrl`. */
export class UpdateContentDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IfSent()
  @TitleRules()
  title?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IfSent()
  @DescriptionRules()
  description?: string;

  @ApiPropertyOptional({ enum: ACCESS_TIERS, enumName: 'AccessTier' })
  @IfSent()
  @AccessTierRules()
  accessTier?: AccessTier;

  @ApiPropertyOptional({ description: 'BCP-47 language tag', example: 'hi' })
  @IfSent()
  @LanguageRules()
  defaultLanguage?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20, description: 'null clears it' })
  @IsOptional()
  @AgeRatingRules()
  ageRating?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, description: 'null clears it' })
  @IsOptional()
  @ThumbnailRules()
  thumbnailUrl?: string | null;

  @ApiPropertyOptional({ minimum: 0, description: '0-based order among siblings (siblings are not renumbered)' })
  @IfSent()
  @PositionRules()
  position?: number;

  @ApiPropertyOptional({ type: String, isArray: true, example: ['IN'], description: 'Replaces the regions' })
  @IfSent()
  @RegionsRules()
  regions?: string[];
}

export class AssetSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: PROCESSING_STATUSES, enumName: 'ProcessingStatus' })
  processingStatus: ProcessingStatus;
}

export class AdminContentDto extends ContentSummaryDto {
  @ApiProperty({ enum: PUBLICATION_STATUSES, enumName: 'PublicationStatus' })
  publicationStatus: PublicationStatus;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentId: string | null;

  @ApiProperty()
  position: number;

  @ApiProperty({ type: String, isArray: true, example: ['IN'] })
  regions: string[];

  @ApiProperty({ type: AssetSummaryDto, nullable: true, description: 'Latest video asset' })
  asset: AssetSummaryDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class AdminContentDetailDto extends AdminContentDto {
  @ApiProperty({ type: AdminContentDto, isArray: true })
  children: AdminContentDto[];
}

export class PaginatedAdminContentDto {
  @ApiProperty({ type: AdminContentDto, isArray: true })
  items: AdminContentDto[];

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  total: number;
}

export class UploadSessionDto {
  @ApiProperty({ format: 'uuid' })
  videoAssetId: string;

  @ApiProperty({ description: 'Short-lived URL to upload the source file to' })
  uploadUrl: string;

  @ApiProperty({ enum: ['PUT'] })
  method: 'PUT';

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Headers the upload request must send',
  })
  headers: Record<string, string>;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}
