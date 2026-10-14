import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Access log with method, path, status and duration only. Headers (Authorization), bodies (refresh
 * tokens, receipts) and query strings (signed media URLs) are never logged.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    const method = request.method;
    const path = stripQuery(request.originalUrl);
    response.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      this.logger.log(`${method} ${path} ${response.statusCode} ${elapsedMs.toFixed(1)}ms`);
    });
    next();
  }
}

export function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}
