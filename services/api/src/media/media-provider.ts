import type { DrmSystem } from '../common/enums';
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
  system: DrmSystem;
  licenseUrl: string;
  /** FairPlay application certificate URL; null otherwise. */
  certificateUrl: string | null;
  /**
   * Headers the player sends on every license request. They carry the short-lived license token
   * bound to the playback session; names are vendor-specific. Secret: never log them.
   */
  licenseRequestHeaders: Record<string, string>;
}

export interface PlaybackAuthorizationRequest {
  providerAssetId: string;
  playbackSessionId: string;
  platform: Platform;
  ttlSeconds: number;
  /** DRM systems the client can play, as reported by it; the provider picks one. */
  supportedDrm?: DrmSystem[];
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
