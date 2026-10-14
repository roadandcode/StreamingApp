import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
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

export class AdminContentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CONTENT_KINDS, enumName: 'ContentKind' })
  @IsOptional()
  @IsIn(CONTENT_KINDS)
  kind?: ContentKind;

  @ApiPropertyOptional({ enum: PUBLICATION_STATUSES, enumName: 'PublicationStatus' })
  @IsOptional()
  @IsIn(PUBLICATION_STATUSES)
  status?: PublicationStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only children of this course' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class CreateContentDto {
  @ApiProperty({ enum: CONTENT_KINDS, enumName: 'ContentKind' })
  @IsIn(CONTENT_KINDS)
  kind: ContentKind;

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MaxLength(5000)
  description: string;

  @ApiProperty({ enum: ACCESS_TIERS, enumName: 'AccessTier' })
  @IsIn(ACCESS_TIERS)
  accessTier: AccessTier;

  @ApiProperty({ description: 'BCP-47 language tag', example: 'hi' })
  @Matches(LANGUAGE_TAG_PATTERN, { message: 'defaultLanguage must be a BCP-47 language tag' })
  defaultLanguage: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20, example: 'UA 13+' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  ageRating?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Parent course. Required for lessons; courses cannot have a parent.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ minimum: 0, default: 0, description: 'Order within the parent course' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  position?: number;

  @ApiProperty({ type: String, isArray: true, example: ['IN'], description: 'ISO-3166 alpha-2 country codes' })
  @Transform(upperList)
  @IsArray()
  @ArrayMaxSize(250)
  @ArrayUnique()
  @EachElement('isCountryCode', (v) => typeof v === 'string' && /^[A-Z]{2}$/.test(v), 'an ISO-3166 alpha-2 country code')
  regions: string[];
}

export class UpdateContentDto extends PartialType(CreateContentDto) {}

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
