import { ParseUUIDPipe, ValidationPipe, type ValidationError } from '@nestjs/common';
import { ValidateBy, type ValidationOptions } from 'class-validator';
import { AppException, type FieldError } from './errors';

/** Marks the index of the offending element in messages produced by `EachElement`. */
const INDEX_MARKER = /^@index:(\d+)\|/;

/**
 * Validates every element of an array with `test`, reporting the first failing element's path
 * (for example `regions.0`) so forms can show the error next to the right input.
 */
export function EachElement(
  name: string,
  test: (value: unknown) => boolean,
  description: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name,
      validator: {
        validate: (value: unknown) => Array.isArray(value) && value.every((element) => test(element)),
        defaultMessage: (args) => {
          const value = args?.value as unknown;
          const index = Array.isArray(value) ? value.findIndex((element) => !test(element)) : -1;
          return index >= 0 ? `@index:${index}|$property.${index} must be ${description}` : `$property must be an array`;
        },
      },
    },
    options,
  );
}

/** Flattens class-validator errors into `{ field, message }` with dotted paths. */
export function toFieldErrors(errors: ValidationError[], parent = ''): FieldError[] {
  const result: FieldError[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    for (const raw of Object.values(error.constraints ?? {})) {
      const indexed = INDEX_MARKER.exec(raw);
      const field = indexed ? `${path}.${indexed[1]}` : path;
      const message = raw.replace(INDEX_MARKER, '');
      result.push({ field, message: parent ? `${path}: ${message}` : message });
    }
    if (error.children?.length) {
      result.push(...toFieldErrors(error.children, path));
    }
  }
  return result;
}

/**
 * Global validation: unknown fields are rejected and every failure is `400 VALIDATION_FAILED` with
 * `errors: [{ field, message }]`.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => {
      const fieldErrors = toFieldErrors(errors);
      const message = fieldErrors.length > 0 ? fieldErrors.map((e) => e.message).join('; ') : 'Validation failed.';
      return new AppException('VALIDATION_FAILED', message, fieldErrors);
    },
  });
}

/** `:id` route parameter that must be a UUID (400 VALIDATION_FAILED with `field: "id"` otherwise). */
export const UUID_PARAM = new ParseUUIDPipe({
  exceptionFactory: () => AppException.invalidField('id', 'id must be a UUID'),
});
