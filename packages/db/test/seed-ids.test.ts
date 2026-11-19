import { describe, it, expect } from 'vitest';
import { UlidSchema } from '@repo/core';
import { SEED_IDS } from '../src/seed-ids.js';

describe('SEED_IDS', () => {
  it.each(Object.entries(SEED_IDS))('%s is a canonical ULID', (_name, id) => {
    expect(UlidSchema.safeParse(id).success).toBe(true);
  });

  it('are unique', () => {
    const ids = Object.values(SEED_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
