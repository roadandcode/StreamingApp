import { Controller, Get, HttpCode, Inject, Param, Put, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { and, eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { AppException } from '../common/errors';
import { Public } from '../common/request-context';
import { AppConfig } from '../config/app-config';
import { type Database, DRIZZLE } from '../database/database.types';
import { videoAssets } from '../database/schema';
import { verifyManifestUrl, verifyUploadUrl } from './fake-media-signing';

/** Discards an upload body without buffering it. */
function drain(request: Request): Promise<void> {
  if (request.readableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    request.on('end', resolve);
    request.on('error', () => resolve());
    request.resume();
  });
}

/**
 * Lets browsers on the allowed origins (admin upload, web player) use these responses: CORS headers
 * come from the global CORS setup; helmet's default `Cross-Origin-Resource-Policy: same-origin` would
 * still block no-cors loads such as a native `<video>` element, so it is relaxed here.
 */
function allowCrossOrigin(response: Response): void {
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

/**
 * Routes that stand in for S3 and CloudFront in development. Mounted only when MEDIA_PROVIDER=fake
 * outside production. The URLs are opaque to clients, so they are not part of the OpenAPI document.
 */
@ApiExcludeController()
@Public()
@Controller('dev/media')
export class DevMediaController {
  constructor(
    private readonly config: AppConfig,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  private get secret(): string {
    const secret = this.config.get('FAKE_MEDIA_SIGNING_SECRET');
    if (!secret) throw new AppException('PROVIDER_NOT_CONFIGURED');
    return secret;
  }

  /** Simulated upload + transcoding: any body marks the asset `ready`; answers 204. */
  @Put('uploads/:providerAssetId')
  @HttpCode(204)
  async upload(
    @Param('providerAssetId') providerAssetId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    allowCrossOrigin(response);
    if (!verifyUploadUrl(this.secret, providerAssetId, request.query, new Date())) {
      await drain(request);
      throw new AppException('INVALID_SIGNATURE');
    }
    await drain(request);
    const updated = await this.db
      .update(videoAssets)
      .set({ processingStatus: 'ready' })
      .where(and(eq(videoAssets.providerAssetId, providerAssetId), eq(videoAssets.provider, 'fake')))
      .returning({ id: videoAssets.id });
    if (updated.length === 0) {
      throw new AppException('NOT_FOUND');
    }
  }

  /** A valid, unexpired manifest URL redirects to the public sample stream. */
  @Get(':providerAssetId/manifest.m3u8')
  manifest(
    @Param('providerAssetId') providerAssetId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    if (!verifyManifestUrl(this.secret, providerAssetId, request.query, new Date())) {
      throw new AppException('INVALID_SIGNATURE');
    }
    allowCrossOrigin(response);
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(302, this.config.get('FAKE_SAMPLE_MANIFEST_URL'));
  }
}
