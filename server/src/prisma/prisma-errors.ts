/** Prisma unique-constraint violation (P2002) — incl. hand-written partial unique indexes. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
