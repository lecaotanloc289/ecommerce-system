// Typed API client generated from the server's OpenAPI spec (`packages/sdk/openapi.json`).
export { createApiClient, IDEMPOTENCY_HEADER } from './client';
export type { ApiClient, ApiClientOptions } from './client';
export type { components, operations, paths } from './schema';

// Zod schemas/types for parsing responses (single source of truth, Golden Rule #1).
export * from '@repo/core';
