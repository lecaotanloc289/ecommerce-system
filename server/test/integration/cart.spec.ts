import { Role } from '@repo/core';
import { ulid } from 'ulid';
import { IDEMPOTENT_REPLAYED_HEADER } from '../../src/common/idempotency/idempotency.interceptor';
import {
  type TestApp,
  createTestApp,
  makeProduct,
  makeShippingMethod,
  makeUser,
  makeVendor,
} from '../support';

interface CartBody {
  groups: {
    vendorId: string;
    vendorName: string;
    lines: {
      variantId: string;
      quantity: number;
      unitPrice: { amount: number; currency: string };
      lineTotal: { amount: number };
      stockAvailable: number;
      unavailable: boolean;
      productName: string;
    }[];
    subtotals: { amount: number; currency: string }[];
  }[];
  itemCount: number;
  hasMixedCurrency: boolean;
}

interface MergeBody {
  cart: CartBody;
  adjustments: {
    variantId: string;
    reason: string;
    requestedQuantity: number;
    appliedQuantity: number;
  }[];
}

describe('cart API (Testcontainers)', () => {
  let t: TestApp;
  let headers: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    const user = await makeUser(t.db);
    userId = user.id;
    headers = await t.authHeader(user);
  });

  const mutate = (
    method: 'PUT' | 'DELETE' | 'POST',
    url: string,
    payload?: object,
    key: string = ulid(),
    auth: Record<string, string> = headers,
  ) =>
    t.app.inject({
      method,
      url,
      headers: { ...auth, 'idempotency-key': key },
      ...(payload && { payload }),
    });
  const getCart = (auth: Record<string, string> = headers) =>
    t.app.inject({ method: 'GET', url: '/v1/cart', headers: auth });

  async function seed() {
    const { vendor: va } = await makeVendor(t.db, { displayName: 'Shop A' });
    const { vendor: vb } = await makeVendor(t.db, { displayName: 'Shop B' });
    const pa = await makeProduct(t.db, {
      vendorId: va.id,
      price: 100_000,
      variants: [{ stockOnHand: 5 }, { stockOnHand: 3, stockReserved: 1 }],
    });
    const pb = await makeProduct(t.db, { vendorId: vb.id, price: 50_000 });
    return { va, vb, pa, pb };
  }

  it('requires authentication and the CUSTOMER role', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/cart' })).statusCode).toBe(401);
    const { vendor } = await makeVendor(t.db);
    const staff = await makeUser(t.db, { roles: [Role.VENDOR_STAFF], vendorId: vendor.id });
    expect((await getCart(await t.authHeader(staff))).statusCode).toBe(403);
  });

  it('returns an empty cart without creating one', async () => {
    const res = await getCart();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ groups: [], itemCount: 0, hasMixedCurrency: false });
    expect(await t.db.cart.count()).toBe(0);
  });

  it('groups lines by vendor with current price, line total and stock', async () => {
    const { pa, pb } = await seed();
    const [a1, a2] = pa.variants;
    const [b1] = pb.variants;
    if (!a1 || !a2 || !b1) throw new Error('seed');

    expect((await mutate('PUT', `/v1/cart/items/${a1.id}`, { quantity: 2 })).statusCode).toBe(200);
    await mutate('PUT', `/v1/cart/items/${b1.id}`, { quantity: 1 });
    await mutate('PUT', `/v1/cart/items/${a2.id}`, { quantity: 2 });

    // Price changes are visible immediately: the cart stores no price.
    await t.db.productVariant.update({ where: { id: a1.id }, data: { priceAmount: 120_000n } });

    const body = (await getCart()).json<CartBody>();
    expect(body.groups.map((g) => g.vendorName)).toEqual(['Shop A', 'Shop B']);
    const groupA = body.groups[0];
    expect(groupA?.lines.map((l) => l.variantId)).toEqual([a1.id, a2.id]);
    expect(groupA?.lines[0]).toMatchObject({
      quantity: 2,
      unitPrice: { amount: 120_000, currency: 'VND' },
      lineTotal: { amount: 240_000 },
      stockAvailable: 5,
      unavailable: false,
      productName: 'Test Product (vi)',
    });
    expect(groupA?.lines[1]?.stockAvailable).toBe(2);
    expect(groupA?.subtotals).toEqual([{ amount: 440_000, currency: 'VND' }]);
    expect(body.itemCount).toBe(5);

    const en = await t.app.inject({ method: 'GET', url: '/v1/cart?locale=en', headers });
    expect(en.json<CartBody>().groups[0]?.lines[0]?.productName).toBe('Test Product');
  });

  it('PUT sets the quantity, 0 removes, over-stock is rejected', async () => {
    const { pa } = await seed();
    const [v] = pa.variants;
    if (!v) throw new Error('seed');
    await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 4 });
    await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 5 });
    expect((await getCart()).json<CartBody>().itemCount).toBe(5);

    const over = await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 6 });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ errorCode: 'cart.error.quantity-exceeds-stock' });
    expect((await getCart()).json<CartBody>().itemCount).toBe(5);

    const removed = await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 0 });
    expect(removed.json<CartBody>().groups).toEqual([]);
  });

  it('PUT rejects unknown and non-sellable variants', async () => {
    const { va, pa } = await seed();
    const [v] = pa.variants;
    if (!v) throw new Error('seed');

    const unknown = await mutate('PUT', `/v1/cart/items/${ulid()}`, { quantity: 1 });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ errorCode: 'product.error.variant-not-found' });

    await t.db.product.update({ where: { id: pa.id }, data: { status: 'BLOCKED' } });
    const blocked = await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 1 });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ errorCode: 'product.error.not-available' });

    await t.db.product.update({ where: { id: pa.id }, data: { status: 'ACTIVE' } });
    await t.db.vendor.update({ where: { id: va.id }, data: { status: 'SUSPENDED' } });
    const suspended = await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 1 });
    expect(suspended.json()).toMatchObject({ errorCode: 'product.error.not-available' });
  });

  it('flags lines of a BLOCKED product as unavailable, excludes them from totals, allows removal', async () => {
    const { pa, pb } = await seed();
    const [a] = pa.variants;
    const [b] = pb.variants;
    if (!a || !b) throw new Error('seed');
    await mutate('PUT', `/v1/cart/items/${a.id}`, { quantity: 2 });
    await mutate('PUT', `/v1/cart/items/${b.id}`, { quantity: 1 });
    await t.db.product.update({ where: { id: pa.id }, data: { status: 'BLOCKED' } });

    const body = (await getCart()).json<CartBody>();
    expect(body.groups[0]?.lines[0]?.unavailable).toBe(true);
    expect(body.groups[0]?.subtotals).toEqual([]);
    expect(body.itemCount).toBe(1);

    const del = await mutate('DELETE', `/v1/cart/items/${a.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json<CartBody>().groups).toHaveLength(1);
    // Removing an absent line is a no-op.
    expect((await mutate('DELETE', `/v1/cart/items/${a.id}`)).statusCode).toBe(200);
  });

  it('flags a cart that mixes currencies', async () => {
    const { vendor } = await makeVendor(t.db);
    const vnd = await makeProduct(t.db, { vendorId: vendor.id });
    const usd = await makeProduct(t.db, { vendorId: vendor.id, currency: 'USD', price: 2_000 });
    for (const p of [vnd, usd]) {
      await mutate('PUT', `/v1/cart/items/${p.variants[0]?.id}`, { quantity: 1 });
    }
    const body = (await getCart()).json<CartBody>();
    expect(body.hasMixedCurrency).toBe(true);
    expect(body.groups[0]?.subtotals.map((s) => s.currency).sort()).toEqual(['USD', 'VND']);
  });

  it('creates exactly one Cart for concurrent first requests', async () => {
    const { pa } = await seed();
    const [v] = pa.variants;
    if (!v) throw new Error('seed');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 1 })),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array.from({ length: 6 }, () => 200));
    expect(await t.db.cart.count({ where: { userId } })).toBe(1);
    expect(await t.db.cartItem.count()).toBe(1);
  });

  it('scopes the cart to the caller', async () => {
    const { pa } = await seed();
    const [v] = pa.variants;
    if (!v) throw new Error('seed');
    await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 1 });
    const other = await t.authHeader(await makeUser(t.db));
    expect((await getCart(other)).json<CartBody>().groups).toEqual([]);
    await mutate('DELETE', `/v1/cart/items/${v.id}`, undefined, ulid(), other);
    expect((await getCart()).json<CartBody>().itemCount).toBe(1);
  });

  it('lets a line be lowered after stock dropped, but not raised', async () => {
    const { vendor } = await makeVendor(t.db);
    const p = await makeProduct(t.db, { vendorId: vendor.id, variants: [{ stockOnHand: 5 }] });
    const v = p.variants[0];
    if (!v) throw new Error('seed');
    await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 5 });
    await t.db.productVariant.update({ where: { id: v.id }, data: { stockOnHand: 2 } });
    expect((await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 3 })).statusCode).toBe(200);
    expect((await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 4 })).statusCode).toBe(409);
  });

  it('caps the number of distinct lines', async () => {
    const { vendor } = await makeVendor(t.db);
    const p = await makeProduct(t.db, {
      vendorId: vendor.id,
      variants: Array.from({ length: 101 }, () => ({ stockOnHand: 5 })),
    });
    const ids = p.variants.map((v) => v.id);
    await t.db.cart.create({
      data: {
        id: ulid(),
        userId,
        items: {
          create: ids.slice(0, 100).map((variantId) => ({ id: ulid(), variantId, quantity: 1 })),
        },
      },
    });
    const extra = ids[100];
    const res = await mutate('PUT', `/v1/cart/items/${extra}`, { quantity: 1 });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ errorCode: 'cart.error.too-many-lines' });
    const merged = await mutate('POST', '/v1/cart/merge', {
      items: [{ variantId: extra, quantity: 1 }],
    });
    expect(merged.json()).toMatchObject({ errorCode: 'cart.error.too-many-lines' });
    // An existing line can still change.
    expect((await mutate('PUT', `/v1/cart/items/${ids[0]}`, { quantity: 2 })).statusCode).toBe(200);
  });

  it('never exceeds the line cap under concurrent PUTs of new lines', async () => {
    const { vendor } = await makeVendor(t.db);
    const p = await makeProduct(t.db, {
      vendorId: vendor.id,
      variants: Array.from({ length: 103 }, () => ({ stockOnHand: 5 })),
    });
    const ids = p.variants.map((v) => v.id);
    await t.db.cart.create({
      data: {
        id: ulid(),
        userId,
        items: {
          create: ids.slice(0, 98).map((variantId) => ({ id: ulid(), variantId, quantity: 1 })),
        },
      },
    });
    const results = await Promise.all(
      ids.slice(98).map((id) => mutate('PUT', `/v1/cart/items/${id}`, { quantity: 1 })),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(2);
    expect(results.filter((r) => r.statusCode === 422)).toHaveLength(3);
    expect(await t.db.cartItem.count()).toBe(100);
  });

  it('keeps a line whose product has no translation, named by its SKU, and removable', async () => {
    const { vendor } = await makeVendor(t.db);
    const p = await makeProduct(t.db, { vendorId: vendor.id });
    const [v] = p.variants;
    if (!v) throw new Error('seed');
    await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 1 });
    await t.db.productTranslation.deleteMany({ where: { productId: p.id } });

    const res = await getCart();
    expect(res.statusCode).toBe(200);
    const line = res.json<CartBody>().groups[0]?.lines[0];
    expect(line?.variantId).toBe(v.id);
    expect(line?.productName).toBe(v.sku);
    const del = await mutate('DELETE', `/v1/cart/items/${v.id}`);
    expect(del.json<CartBody>().groups).toHaveLength(0);
  });

  describe('POST /v1/cart/merge', () => {
    it('adds exactly once per request under concurrent merges', async () => {
      const { pb } = await seed();
      const [v] = pb.variants;
      if (!v) throw new Error('seed');
      const payload = { items: [{ variantId: v.id, quantity: 1 }] };
      const res = await Promise.all(
        Array.from({ length: 5 }, () => mutate('POST', '/v1/cart/merge', payload)),
      );
      expect(res.map((r) => r.statusCode)).toEqual(Array.from({ length: 5 }, () => 200));
      expect((await getCart()).json<CartBody>().itemCount).toBe(5);
    });

    it('leaves an existing line of a now-unsellable variant untouched and reports it', async () => {
      const { pa } = await seed();
      const [v] = pa.variants;
      if (!v) throw new Error('seed');
      await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 2 });
      await t.db.product.update({ where: { id: pa.id }, data: { status: 'BLOCKED' } });
      const res = await mutate('POST', '/v1/cart/merge', {
        items: [{ variantId: v.id, quantity: 1 }],
      });
      const body = res.json<MergeBody>();
      expect(body.adjustments).toEqual([
        { variantId: v.id, reason: 'UNAVAILABLE', requestedQuantity: 1, appliedQuantity: 0 },
      ]);
      expect(body.cart.groups[0]?.lines[0]).toMatchObject({ quantity: 2, unavailable: true });
    });

    it('sums with existing lines, clamps to stock, drops unknown/unsellable, reports adjustments', async () => {
      const { pa, pb } = await seed();
      const [a1, a2] = pa.variants; // stock 5, available 2
      const [b1] = pb.variants; // stock 10
      if (!a1 || !a2 || !b1) throw new Error('seed');
      const blocked = await makeProduct(t.db, { vendorId: pb.vendorId, status: 'BLOCKED' });
      const blockedVariant = blocked.variants[0];
      if (!blockedVariant) throw new Error('seed');

      await mutate('PUT', `/v1/cart/items/${a1.id}`, { quantity: 2 });
      const ghost = ulid();
      const res = await mutate('POST', '/v1/cart/merge', {
        items: [
          { variantId: a1.id, quantity: 2 },
          { variantId: a1.id, quantity: 2 }, // duplicate lines are summed: 2 + 4 = 6 > 5
          { variantId: a2.id, quantity: 9 }, // available 2
          { variantId: b1.id, quantity: 3 },
          { variantId: ghost, quantity: 1 },
          { variantId: blockedVariant.id, quantity: 1 },
        ],
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<MergeBody>();
      const qty = new Map(
        body.cart.groups.flatMap((g) => g.lines).map((l) => [l.variantId, l.quantity]),
      );
      expect(qty.get(a1.id)).toBe(5);
      expect(qty.get(a2.id)).toBe(2);
      expect(qty.get(b1.id)).toBe(3);
      expect(qty.has(ghost)).toBe(false);
      expect(qty.has(blockedVariant.id)).toBe(false);
      expect(body.adjustments).toEqual(
        expect.arrayContaining([
          { variantId: a1.id, reason: 'CLAMPED', requestedQuantity: 6, appliedQuantity: 5 },
          { variantId: a2.id, reason: 'CLAMPED', requestedQuantity: 9, appliedQuantity: 2 },
          { variantId: ghost, reason: 'UNAVAILABLE', requestedQuantity: 1, appliedQuantity: 0 },
          {
            variantId: blockedVariant.id,
            reason: 'UNAVAILABLE',
            requestedQuantity: 1,
            appliedQuantity: 0,
          },
        ]),
      );
      expect(body.adjustments).toHaveLength(4);
    });

    it('never lowers an existing line and adds nothing when out of stock', async () => {
      const { vendor } = await makeVendor(t.db);
      const p = await makeProduct(t.db, { vendorId: vendor.id, variants: [{ stockOnHand: 3 }] });
      const v = p.variants[0];
      if (!v) throw new Error('seed');
      await mutate('PUT', `/v1/cart/items/${v.id}`, { quantity: 3 });
      await t.db.productVariant.update({ where: { id: v.id }, data: { stockOnHand: 1 } });

      const res = await mutate('POST', '/v1/cart/merge', {
        items: [{ variantId: v.id, quantity: 2 }],
      });
      const body = res.json<MergeBody>();
      expect(body.cart.groups[0]?.lines[0]?.quantity).toBe(3);
      expect(body.adjustments).toEqual([
        { variantId: v.id, reason: 'CLAMPED', requestedQuantity: 5, appliedQuantity: 3 },
      ]);
    });

    it('replays under the same Idempotency-Key; a new key adds the quantities again', async () => {
      const { pb } = await seed();
      const [v] = pb.variants;
      if (!v) throw new Error('seed');
      const payload = { items: [{ variantId: v.id, quantity: 2 }] };
      const key = ulid();

      const first = await mutate('POST', '/v1/cart/merge', payload, key);
      const replay = await mutate('POST', '/v1/cart/merge', payload, key);
      expect(replay.headers[IDEMPOTENT_REPLAYED_HEADER]).toBe('true');
      expect(replay.json()).toEqual(first.json());
      expect((await getCart()).json<CartBody>().itemCount).toBe(2);

      const again = await mutate('POST', '/v1/cart/merge', payload, ulid());
      expect(again.json<MergeBody>().cart.itemCount).toBe(4);
    });

    it('rejects an empty body', async () => {
      const res = await mutate('POST', '/v1/cart/merge', { items: [] });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('GET /v1/cart/shipping-options', () => {
    it('lists active methods of each vendor in the cart only', async () => {
      const { va, vb, pa, pb } = await seed();
      const other = await makeVendor(t.db);
      const m1 = await makeShippingMethod(t.db, { vendorId: va.id, price: 20_000 });
      await makeShippingMethod(t.db, { vendorId: va.id, isActive: false });
      const m2 = await makeShippingMethod(t.db, { vendorId: vb.id });
      await makeShippingMethod(t.db, { vendorId: other.vendor.id });
      const [a] = pa.variants;
      const [b] = pb.variants;
      if (!a || !b) throw new Error('seed');
      await mutate('PUT', `/v1/cart/items/${a.id}`, { quantity: 1 });
      await mutate('PUT', `/v1/cart/items/${b.id}`, { quantity: 1 });

      const res = await t.app.inject({
        method: 'GET',
        url: '/v1/cart/shipping-options',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        groups: { vendorId: string; methods: { id: string; price: { amount: number } }[] }[];
      }>();
      expect(body.groups.map((g) => g.vendorId)).toEqual([va.id, vb.id]);
      expect(body.groups[0]?.methods.map((m) => m.id)).toEqual([m1.id]);
      expect(body.groups[0]?.methods[0]?.price.amount).toBe(20_000);
      expect(body.groups[1]?.methods.map((m) => m.id)).toEqual([m2.id]);
    });

    it('is empty for an empty cart', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: '/v1/cart/shipping-options',
        headers,
      });
      expect(res.json()).toEqual({ groups: [] });
    });
  });
});
