import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors';
import type { ProcessingStatus } from '../database/schema';
import type {
  MediaProvider,
  PlaybackAuthorizationRequest,
  ProviderPlaybackAuthorization,
  UploadSession,
} from './media-provider';

/**
 * Production media provider. Not configured yet: every method fails closed with
 * `503 PROVIDER_NOT_CONFIGURED`, so nothing is ever uploaded or played without the real pipeline.
 */
@Injectable()
export class AwsMediaProvider implements MediaProvider {
  readonly name = 'aws' as const;

  createUploadSession(contentId: string): Promise<UploadSession> {
    void contentId;
    // TODO: create the asset key under the private source bucket and return an S3 presigned PUT URL
    //   (short expiry, fixed Content-Type, size limit) plus the headers the client must send.
    return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
  }

  getAssetStatus(providerAssetId: string): Promise<ProcessingStatus> {
    void providerAssetId;
    // TODO: start an AWS Elemental MediaConvert job (HLS/CMAF renditions, encryption through the
    //   multi-DRM vendor's SPEKE endpoint) when the upload lands, and map the job state to
    //   awaiting_upload | processing | ready | failed (EventBridge job notifications or polling).
    return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
  }

  createPlaybackAuthorization(request: PlaybackAuthorizationRequest): Promise<ProviderPlaybackAuthorization> {
    void request;
    // TODO: sign a CloudFront URL or signed cookies (key group, short expiry bound to the playback
    //   session) for the manifest and segments, and fetch a short-lived license token from the
    //   multi-DRM vendor: Widevine for android, FairPlay (with the application certificate URL) for
    //   ios. Record the issuance in drm_license_audit.
    return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
  }
}
