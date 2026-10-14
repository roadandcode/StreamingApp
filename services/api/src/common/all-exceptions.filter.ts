import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppException, type ErrorBody, type ErrorCode } from './errors';

const STATUS_FALLBACK_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Maps every error to the contract's `{statusCode, code, message}` shape without leaking internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const body = this.toBody(exception, request);
    if (response.headersSent) {
      return;
    }
    response.status(body.statusCode).json(body);
  }

  toBody(exception: unknown, request?: Request): ErrorBody {
    if (exception instanceof AppException) {
      return exception.body;
    }
    if (exception instanceof ThrottlerException) {
      return { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' };
    }
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    const bodyParserError = this.fromBodyParserError(exception);
    if (bodyParserError) {
      return bodyParserError;
    }
    // Unknown error: log it server-side (path only, never headers or query strings).
    const path = request?.path ?? 'unknown path';
    const method = request?.method ?? '';
    this.logger.error(
      `Unhandled error on ${method} ${path}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong.' };
  }

  private fromHttpException(exception: HttpException): ErrorBody {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const code: ErrorCode =
      STATUS_FALLBACK_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED');
    if (status >= 500) {
      return { statusCode: status, code, message: 'Something went wrong.' };
    }
    if (status === 404) {
      // Router 404s echo the URL; keep the response generic.
      return { statusCode: 404, code, message: 'Not found.' };
    }
    const message = extractMessage(response, exception.message);
    return code === 'VALIDATION_FAILED' ? { statusCode: status, code, message, errors: [] } : { statusCode: status, code, message };
  }

  /** Malformed JSON and oversize bodies are reported by body-parser before routing. */
  private fromBodyParserError(exception: unknown): ErrorBody | null {
    if (typeof exception !== 'object' || exception === null) return null;
    const candidate = exception as { type?: unknown; status?: unknown };
    if (typeof candidate.type !== 'string' || typeof candidate.status !== 'number') return null;
    if (candidate.type === 'entity.too.large') {
      return {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'VALIDATION_FAILED',
        message: 'Request body is too large.',
        errors: [],
      };
    }
    if (candidate.status >= 400 && candidate.status < 500) {
      return { statusCode: 400, code: 'VALIDATION_FAILED', message: 'Request body could not be parsed.', errors: [] };
    }
    return null;
  }
}

function extractMessage(response: string | object, fallback: string): string {
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) {
    const parts = message.filter((m): m is string => typeof m === 'string');
    return parts.length > 0 ? parts.join('; ') : fallback;
  }
  if (typeof message === 'string') return message;
  return fallback;
}
