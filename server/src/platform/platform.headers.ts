/** OpenAPI description of the `Idempotency-Key` header shared by every platform mutation. */
export const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;
