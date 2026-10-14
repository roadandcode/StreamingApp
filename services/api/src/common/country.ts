import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { AppConfig } from '../config/app-config';
import type { AppRequest } from './request-context';

export interface CountryResolverOptions {
  /** Lowercase header name set by the trusted CDN, e.g. `cloudfront-viewer-country`. */
  trustedHeader?: string;
  defaultCountry: string;
}

/**
 * The viewer's country comes only from the trusted CDN header (when configured) or the default.
 * Clients cannot choose it: without a configured header, request headers are ignored entirely.
 */
export function resolveCountry(
  headers: Record<string, string | string[] | undefined>,
  options: CountryResolverOptions,
): string {
  if (options.trustedHeader) {
    const raw = headers[options.trustedHeader];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value)) {
      return value;
    }
  }
  return options.defaultCountry;
}

@Injectable()
export class CountryMiddleware implements NestMiddleware {
  constructor(private readonly config: AppConfig) {}

  use(request: AppRequest, _response: Response, next: NextFunction): void {
    request.viewerCountry = resolveCountry(request.headers, {
      trustedHeader: this.config.get('TRUSTED_COUNTRY_HEADER'),
      defaultCountry: this.config.get('DEFAULT_COUNTRY_CODE'),
    });
    next();
  }
}
