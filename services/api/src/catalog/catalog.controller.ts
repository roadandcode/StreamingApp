import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../common/api-docs';
import { Public, ViewerCountry } from '../common/request-context';
import { CatalogQueryDto, ContentDetailDto, PaginatedContentSummaryDto } from './catalog.dto';
import { CatalogService } from './catalog.service';
import { UUID_PARAM } from '../common/validation';

@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog')
  @ApiOperation({
    summary: 'Browse the catalog',
    description: "Published, top-level items available in the viewer's country.",
  })
  @ApiOkResponse({ type: PaginatedContentSummaryDto })
  @ApiErrors('VALIDATION_FAILED')
  list(@Query() query: CatalogQueryDto, @ViewerCountry() country: string): Promise<PaginatedContentSummaryDto> {
    return this.catalog.list(query, country);
  }

  @Get('content/:id')
  @ApiOperation({ summary: 'Content detail with its published lessons and subtitles' })
  @ApiOkResponse({ type: ContentDetailDto })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  detail(@Param('id', UUID_PARAM) id: string, @ViewerCountry() country: string): Promise<ContentDetailDto> {
    return this.catalog.detail(id, country);
  }
}
