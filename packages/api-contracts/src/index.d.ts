/**
 * Types for the StreamingApp v1 API, generated from openapi.json (see ./schema.d.ts).
 * Regenerate with `pnpm --filter @streamingapp/api openapi:emit` and then
 * `pnpm --filter @streamingapp/api-contracts generate`.
 */
import type { components, operations, paths } from './schema.js';

export type { components, operations, paths };

/** Every named schema, e.g. `Schemas['SubscriptionViewDto']`. */
export type Schemas = components['schemas'];

export type ErrorResponse = Schemas['ErrorResponseDto'];
export type ErrorCode = Schemas['ErrorCode'];
export type User = Schemas['UserDto'];
export type Tokens = Schemas['TokensDto'];
export type AuthResponse = Schemas['AuthResponseDto'];
export type ContentSummary = Schemas['ContentSummaryDto'];
export type ContentDetail = Schemas['ContentDetailDto'];
export type SubscriptionView = Schemas['SubscriptionViewDto'];
export type Plan = Schemas['PlanDto'];
export type Device = Schemas['DeviceDto'];
export type PlaybackAuthorization = Schemas['PlaybackAuthorizationDto'];
export type AdminContent = Schemas['AdminContentDto'];
export type AdminContentDetail = Schemas['AdminContentDetailDto'];
export type UploadSession = Schemas['UploadSessionDto'];
export type AdminUserDetail = Schemas['AdminUserDetailDto'];
export type FieldError = Schemas['FieldErrorDto'];
export type DrmSystem = Schemas['DrmSystem'];
export type RazorpayCheckoutSubscription = Schemas['RazorpayCheckoutSubscriptionDto'];
