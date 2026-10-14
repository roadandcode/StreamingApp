import { HttpException } from '@nestjs/common';

/** Stable error codes from the API contract. Clients branch on these. */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  INVALID_PURCHASE: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_REFRESH_TOKEN: 401,
  INVALID_SIGNATURE: 401,
  FORBIDDEN: 403,
  ACCOUNT_INACTIVE: 403,
  ENTITLEMENT_REQUIRED: 403,
  REGION_NOT_ALLOWED: 403,
  CONTENT_NOT_PLAYABLE: 403,
  DEVICE_NOT_REGISTERED: 403,
  DEVICE_REVOKED: 403,
  CONCURRENT_STREAM_LIMIT: 403,
  PLAYBACK_SESSION_ENDED: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  DEVICE_LIMIT_REACHED: 409,
  PURCHASE_BELONGS_TO_OTHER_ACCOUNT: 409,
  ASSET_NOT_READY: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PROVIDER_NOT_CONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

const DEFAULT_MESSAGES: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: 'Authentication is required.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  INVALID_REFRESH_TOKEN: 'The refresh token is invalid or has expired.',
  INVALID_SIGNATURE: 'The signature is invalid or has expired.',
  FORBIDDEN: 'You do not have permission to do this.',
  ACCOUNT_INACTIVE: 'This account is not active.',
  ENTITLEMENT_REQUIRED: 'An active subscription is required to watch this content.',
  REGION_NOT_ALLOWED: 'This content is not available in your country.',
  CONTENT_NOT_PLAYABLE: 'This content has no playable video.',
  DEVICE_NOT_REGISTERED: 'This device is not registered to your account.',
  DEVICE_REVOKED: 'This device has been removed from your account.',
  CONCURRENT_STREAM_LIMIT: 'Too many streams are playing at the same time on this account.',
  PLAYBACK_SESSION_ENDED: 'This playback session has ended.',
  NOT_FOUND: 'Not found.',
  EMAIL_TAKEN: 'An account with this email already exists.',
  DEVICE_LIMIT_REACHED: 'The maximum number of devices is already registered.',
  PURCHASE_BELONGS_TO_OTHER_ACCOUNT: 'This purchase is already linked to another account.',
  ASSET_NOT_READY: 'The video has not finished uploading and processing.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  INTERNAL_ERROR: 'Something went wrong.',
  PROVIDER_NOT_CONFIGURED: 'This provider integration is not configured.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
};

/** One invalid request field; `field` is its path, e.g. `title` or `regions.0` (empty: the whole request). */
export interface FieldError {
  field: string;
  message: string;
}

export interface ErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  /** Present on `400 VALIDATION_FAILED`. */
  errors?: FieldError[];
}

/**
 * An error with a contract error code; the global filter renders it as `{statusCode, code, message}`
 * (plus `errors` for VALIDATION_FAILED).
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string, errors?: FieldError[]) {
    const status = ERROR_STATUS[code];
    const body: ErrorBody = { statusCode: status, code, message: message ?? DEFAULT_MESSAGES[code] ?? code };
    if (code === 'VALIDATION_FAILED') {
      body.errors = errors ?? [];
    }
    super(body, status);
    this.code = code;
  }

  /** A VALIDATION_FAILED error about one field. */
  static invalidField(field: string, message: string): AppException {
    return new AppException('VALIDATION_FAILED', message, [{ field, message }]);
  }

  get body(): ErrorBody {
    return this.getResponse() as ErrorBody;
  }
}
