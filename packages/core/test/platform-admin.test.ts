import { describe, expect, it } from 'vitest';
import {
  PlatformOrderListQuerySchema,
  PlatformProductBlockSchema,
  PlatformProductListQuerySchema,
  PlatformRoleGrantSchema,
  PlatformUserListQuerySchema,
  PlatformVendorListQuerySchema,
  PlatformVendorSuspendSchema,
} from '../src';

describe('platform admin schemas', () => {
  it('parses list queries: status filter, paging coercion, blank q = absent', () => {
    expect(PlatformVendorListQuerySchema.parse({ status: 'SUSPENDED', limit: '5' })).toMatchObject({
      status: 'SUSPENDED',
      limit: 5,
    });
    expect(PlatformVendorListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(PlatformUserListQuerySchema.parse({ q: ' Ann ' }).q).toBe('Ann');
    expect(PlatformOrderListQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
    expect(PlatformProductListQuerySchema.safeParse({ vendorId: 'not-a-ulid' }).success).toBe(
      false,
    );
  });

  it('requires a non-empty reason to suspend or block', () => {
    expect(PlatformVendorSuspendSchema.parse({ reason: ' fraud ' }).reason).toBe('fraud');
    expect(PlatformVendorSuspendSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(PlatformProductBlockSchema.safeParse({}).success).toBe(false);
    expect(PlatformProductBlockSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it('only grants platform roles', () => {
    expect(PlatformRoleGrantSchema.parse({ role: 'PLATFORM_STAFF' }).role).toBe('PLATFORM_STAFF');
    expect(PlatformRoleGrantSchema.safeParse({ role: 'VENDOR_OWNER' }).success).toBe(false);
    expect(PlatformRoleGrantSchema.safeParse({ role: 'CUSTOMER' }).success).toBe(false);
  });
});
