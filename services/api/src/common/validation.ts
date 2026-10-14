import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { AppException } from './errors';

function flatten(errors: ValidationError[], parent = ''): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      for (const message of Object.values(error.constraints)) {
        // class-validator prefixes nested messages with the leaf property only; show the full path.
        messages.push(parent ? `${path}: ${message}` : message);
      }
    }
    if (error.children?.length) {
      messages.push(...flatten(error.children, path));
    }
  }
  return messages;
}

/** Global validation: unknown fields are rejected and every failure is `400 VALIDATION_FAILED`. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => {
      const messages = flatten(errors);
      return new AppException('VALIDATION_FAILED', messages.length > 0 ? messages.join('; ') : 'Validation failed.');
    },
  });
}
