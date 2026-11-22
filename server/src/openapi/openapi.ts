import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

/** Name of the bearer security scheme (`@ApiBearerAuth(BEARER_AUTH)`). */
export const BEARER_AUTH = 'bearer';
/** Name of the refresh-cookie security scheme (`@ApiCookieAuth(REFRESH_COOKIE_AUTH)`). */
export const REFRESH_COOKIE_AUTH = 'refresh-cookie';

/**
 * Builds the OpenAPI document for an initialised app (global prefix already set).
 * `cleanupOpenApiDoc` is required for nestjs-zod DTOs to render correctly.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Marketplace API')
    .setDescription('Multi-vendor marketplace REST API (`/v1`).')
    .setVersion('1.0.0')
    .setOpenAPIVersion('3.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, BEARER_AUTH)
    .addCookieAuth('refresh_token', { type: 'apiKey', in: 'cookie' }, REFRESH_COOKIE_AUTH)
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}
