import { ApiProperty, ApiPropertyOptional, ApiResponse, DECORATORS } from '@nestjs/swagger';
import { ERROR_CODES, type ErrorCode, ERROR_STATUS } from './errors';

export class FieldErrorDto {
  @ApiProperty({ example: 'regions.0', description: 'Path of the invalid request field' })
  field: string;

  @ApiProperty({ example: 'regions.0 must be an ISO-3166 alpha-2 country code' })
  message: string;
}

/** The error body every non-2xx response uses. */
export class ErrorResponseDto {
  @ApiProperty({ example: 403 })
  statusCode: number;

  @ApiProperty({ enum: ERROR_CODES, enumName: 'ErrorCode', example: 'ENTITLEMENT_REQUIRED' })
  code: ErrorCode;

  @ApiProperty({ example: 'An active subscription is required to watch this content.' })
  message: string;

  @ApiPropertyOptional({
    type: FieldErrorDto,
    isArray: true,
    description: 'Present on 400 VALIDATION_FAILED: one entry per invalid field.',
  })
  errors?: FieldErrorDto[];
}

const ERROR_CODES_KEY = Symbol('api-error-codes');

type Handler = (...args: unknown[]) => unknown;

function documentHandler(target: object, key: string | symbol, descriptor: PropertyDescriptor, codes: ErrorCode[]): void {
  const handler = descriptor.value as Handler;
  const merged = [...new Set([...((Reflect.getMetadata(ERROR_CODES_KEY, handler) as ErrorCode[] | undefined) ?? []), ...codes])];
  Reflect.defineMetadata(ERROR_CODES_KEY, merged, handler);
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of merged) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  // Replace (rather than append to) entries written by an earlier ApiErrors on the same handler.
  const responses = Reflect.getMetadata(DECORATORS.API_RESPONSE, handler) as Record<string, unknown> | undefined;
  if (responses) {
    const kept = Object.fromEntries(Object.entries(responses).filter(([status]) => !byStatus.has(Number(status))));
    Reflect.defineMetadata(DECORATORS.API_RESPONSE, kept, handler);
  }
  for (const [status, statusCodes] of byStatus) {
    ApiResponse({ status, description: statusCodes.join(' | '), type: ErrorResponseDto })(target, key, descriptor);
  }
}

/**
 * Documents the error codes a route can return, grouped by HTTP status. On a controller it adds the
 * codes to every route, merged with the route's own codes (so a shared 403 lists all of them).
 */
export function ApiErrors(...codes: ErrorCode[]): MethodDecorator & ClassDecorator {
  return ((target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (key !== undefined && descriptor) {
      documentHandler(target, key, descriptor, codes);
      return descriptor;
    }
    const prototype = (target as { prototype: object }).prototype;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;
      const methodDescriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (methodDescriptor && typeof methodDescriptor.value === 'function') {
        documentHandler(prototype, name, methodDescriptor, codes);
      }
    }
    return undefined;
  }) as MethodDecorator & ClassDecorator;
}
