import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, description: '1-based page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PageRequest {
  page: number;
  pageSize: number;
  offset: number;
}

export function toPageRequest(query: PaginationQueryDto): PageRequest {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return { page, pageSize, offset: (page - 1) * pageSize };
}
