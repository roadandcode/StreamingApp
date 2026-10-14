import type { Platform, ProcessingStatus } from '../database/schema';

/**
 * Seam between the backend and the video pipeline (storage, transcoding, CDN, DRM). The rest of the
 * code never knows which provider is in use; `MEDIA_PROVIDER` selects the implementation at startup.
 */
export interface UploadSession {
  providerAssetId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface DrmAuthorization {
  system: 'widevine' | 'fairplay';
  licenseUrl: string;
  /** FairPlay application certificate URL; null for Widevine. */
  certificateUrl: string | null;
  /** Short-lived license token bound to the playback session. */
  token: string;
}

export interface PlaybackAuthorizationRequest {
  providerAssetId: string;
  playbackSessionId: string;
  platform: Platform;
  ttlSeconds: number;
}

export interface ProviderPlaybackAuthorization {
  /** Short-lived; never a permanent public URL. */
  manifestUrl: string;
  expiresAt: Date;
  drm: DrmAuthorization | null;
}

export interface MediaProvider {
  readonly name: 'fake' | 'aws';
  /** Creates a new asset for the content item and a short-lived URL to upload its source file. */
  createUploadSession(contentId: string): Promise<UploadSession>;
  getAssetStatus(providerAssetId: string): Promise<ProcessingStatus>;
  createPlaybackAuthorization(request: PlaybackAuthorizationRequest): Promise<ProviderPlaybackAuthorization>;
}

export const MEDIA_PROVIDER = Symbol('MEDIA_PROVIDER');
