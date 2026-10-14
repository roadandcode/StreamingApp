import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

function operationId(controllerKey: string, methodKey: string): string {
  const controller = controllerKey.replace(/Controller$/, '');
  return `${controller.charAt(0).toLowerCase()}${controller.slice(1)}${methodKey.charAt(0).toUpperCase()}${methodKey.slice(1)}`;
}

/** The OpenAPI document for the v1 API (served at /docs and emitted to packages/api-contracts). */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('StreamingApp API')
    .setDescription(
      'Backend for the StreamingApp mobile apps and admin dashboard. Every error response has the shape ' +
        '`{ statusCode, code, message }`; clients branch on `code`. See docs/architecture/api-contract.md.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();
  return SwaggerModule.createDocument(app, config, { operationIdFactory: operationId });
}
