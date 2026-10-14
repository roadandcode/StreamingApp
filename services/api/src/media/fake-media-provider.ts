import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AppException } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { type Database, DRIZZLE } from '../database/database.types';
import { type ProcessingStatus, videoAssets } from '../database/schema';
import { signManifestUrl, signUploadUrl } from './fake-media-signing';
import type {
  MediaProvider,
  PlaybackAuthorizationRequest,
  ProviderPlaybackAuthorization,
  UploadSession,
} from './media-provider';

/** How long a fake upload URL stays valid. */
export const FAKE_UPLOAD_TTL_SECONDS = 3600;

/**
 * Development and test stand-in for the real pipeline. Upload and manifest URLs point at the API's
 * own `/v1/dev/media/*` routes and are HMAC-signed with FAKE_MEDIA_SIGNING_SECRET. There is no DRM.
 */
@Injectable()
export class FakeMediaProvider implements MediaProvider {
  readonly name = 'fake' as const;

  constructor(
    private readonly config: AppConfig,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  private get secret(): string {
    const secret = this.config.get('FAKE_MEDIA_SIGNING_SECRET');
    if (!secret) throw new AppException('PROVIDER_NOT_CONFIGURED');
    return secret;
  }

  createUploadSession(contentId: string): Promise<UploadSession> {
    void contentId;
    const providerAssetId = `fake_${randomUUID()}`;
    const exp = Math.floor(Date.now() / 1000) + FAKE_UPLOAD_TTL_SECONDS;
    return Promise.resolve({
      providerAssetId,
      uploadUrl: signUploadUrl(this.config.get('PUBLIC_API_BASE_URL'), this.secret, providerAssetId, exp),
      method: 'PUT',
      headers: {},
      expiresAt: new Date(exp * 1000),
    });
  }

  /** The fake pipeline's state is the asset row itself: the upload route marks it ready. */
  async getAssetStatus(providerAssetId: string): Promise<ProcessingStatus> {
    const [asset] = await this.db
      .select({ status: videoAssets.processingStatus })
      .from(videoAssets)
      .where(eq(videoAssets.providerAssetId, providerAssetId))
      .limit(1);
    return asset?.status ?? 'failed';
  }

  createPlaybackAuthorization(request: PlaybackAuthorizationRequest): Promise<ProviderPlaybackAuthorization> {
    const exp = Math.floor(Date.now() / 1000) + request.ttlSeconds;
    return Promise.resolve({
      manifestUrl: signManifestUrl(
        this.config.get('PUBLIC_API_BASE_URL'),
        this.secret,
        request.providerAssetId,
        request.playbackSessionId,
        exp,
      ),
      expiresAt: new Date(exp * 1000),
      drm: null,
    });
  }
}
