import { cursorPageArgs, toPage } from '../../src/common/pagination';
import { MeResponseSchema, PageQuerySchema } from '@repo/core';
import {
  type TestApp,
  createTestApp,
  makeAddress,
  makeCategory,
  makePlatformSettings,
  makeProduct,
  makeShippingMethod,
  makeUser,
  makeVendor,
} from '../support';

/** Sample spec for the integration harness: real AppModule, Postgres, Redis, factories, JWTs. */
describe('integration harness', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('boots the real app against the migrated database', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('authHeader signs a real access token from the user’s DB roles', async () => {
    const { vendor, owner } = await makeVendor(t.db);
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: await t.authHeader(owner),
    });
    expect(res.statusCode).toBe(200);
    const me = MeResponseSchema.parse(res.json());
    expect(me).toMatchObject({ id: owner.id, vendorId: vendor.id });
    expect(me.roles.sort()).toEqual(['CUSTOMER', 'VENDOR_OWNER']);
  });

  it('a SUSPENDED vendor grants no vendor role', async () => {
    const { owner } = await makeVendor(t.db, { status: 'SUSPENDED' });
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: await t.authHeader(owner),
    });
    expect(MeResponseSchema.parse(res.json())).toMatchObject({
      roles: ['CUSTOMER'],
      vendorId: null,
    });
  });

  it('signAccessToken crafts claims without touching the DB', async () => {
    const user = await makeUser(t.db);
    const token = await t.signAccessToken(user, ['PLATFORM_ADMIN']);
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    // /me re-reads roles from the DB; the guard accepted the crafted token.
    expect(res.statusCode).toBe(200);
  });

  it('factories build a purchasable catalog', async () => {
    await makePlatformSettings(t.db, { commissionBps: 500 });
    const customer = await makeUser(t.db);
    const address = await makeAddress(t.db, { userId: customer.id, isDefault: true });
    const { vendor } = await makeVendor(t.db);
    const category = await makeCategory(t.db);
    const product = await makeProduct(t.db, {
      vendorId: vendor.id,
      categoryIds: [category.id],
      variants: [{ stockOnHand: 3 }, { price: 120_000, stockOnHand: 0 }],
    });
    const shipping = await makeShippingMethod(t.db, { vendorId: vendor.id });

    expect(address.isDefault).toBe(true);
    expect(product.translations.map((tr) => tr.locale).sort()).toEqual(['EN', 'VI']);
    expect(product.variants.map((v) => [v.priceAmount, v.stockOnHand])).toEqual([
      [100_000n, 3],
      [120_000n, 0],
    ]);
    expect(shipping.priceAmount).toBe(30_000n);
    await expect(t.db.platformSettings.findFirstOrThrow()).resolves.toMatchObject({
      commissionBps: 500,
    });
  });

  it('cursor pagination walks newest-first without gaps or repeats', async () => {
    const created = [];
    for (let i = 0; i < 5; i += 1) created.push((await makeUser(t.db)).id);
    const expected = [...created].sort().reverse();

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const query = PageQuerySchema.parse({ limit: '2', cursor });
      const args = cursorPageArgs(query);
      const rows = await t.db.user.findMany({ ...args, select: { id: true } });
      const result = toPage(rows, query);
      seen.push(...result.items.map((row) => row.id));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual(expected);
  });

  it('reset() empties the database and Redis', async () => {
    await makeUser(t.db);
    await t.redis.set('k', 'v');
    await t.reset();
    await expect(t.db.user.count()).resolves.toBe(0);
    await expect(t.redis.dbsize()).resolves.toBe(0);
  });
});
