import { MeResponseSchema, type MeResponse, type Role } from '@repo/core';

export const USER_ID = '01JC0000000000000000000001';
export const VENDOR_ID = '01JC0000000000000000000002';

/** A signed-in user with the given roles (vendor roles also get a vendorId, like the API). */
export function makeUser(roles: Role[]): MeResponse {
  const isVendor = roles.includes('VENDOR_OWNER') || roles.includes('VENDOR_STAFF');
  return MeResponseSchema.parse({
    id: USER_ID,
    email: 'lan@example.com',
    name: 'Lan Nguyễn',
    avatarUrl: null,
    primaryLocale: 'VI',
    roles,
    vendorId: isVendor ? VENDOR_ID : null,
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
