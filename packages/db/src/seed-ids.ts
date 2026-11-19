// Fixed ids for seeded rows, so re-running the seed upserts the same rows (idempotent).
// Canonical ULIDs (they must pass @repo/core's XxxIdSchema); the `01SEED` prefix makes
// seeded rows easy to recognise in a local DB. Never reuse these values for real data.
export const SEED_IDS = {
  settings: '01SEED00000000000000000001',
  demoUser: '01SEED00000000000000000002',
  vendorAOwner: '01SEED00000000000000000003',
  vendorBOwner: '01SEED00000000000000000004',
  vendorA: '01SEED00000000000000000005',
  vendorB: '01SEED00000000000000000006',
  walletA: '01SEED00000000000000000007',
  walletB: '01SEED00000000000000000008',
  catRoot: '01SEED00000000000000000009',
  catApparel: '01SEED0000000000000000000A',
  productA1: '01SEED0000000000000000000B',
  variantA1: '01SEED0000000000000000000C',
} as const;
