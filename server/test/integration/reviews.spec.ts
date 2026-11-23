import {
  ProductDetailSchema,
  ReviewPageSchema,
  ReviewSchema,
  type SubOrderStatus,
} from '@repo/core';
import { ulid } from 'ulid';
import { type TestApp, createTestApp, makeProduct, makeUser, makeVendor } from '../support';

describe('product reviews', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  /** A sub-order in `status` owned by `customerId`, with one item per given variant. */
  async function makeSubOrder(
    customerId: string,
    vendorId: string,
    variantIds: readonly string[],
    status: SubOrderStatus = 'DELIVERED',
  ) {
    const orderId = ulid();
    const subOrderId = ulid();
    await t.db.order.create({
      data: {
        id: orderId,
        customerId,
        status: 'PAID',
        currency: 'VND',
        itemsTotalAmount: 100_000n,
        shippingTotalAmount: 0n,
        grandTotalAmount: 100_000n,
        idempotencyKey: ulid(),
        subOrders: {
          create: {
            id: subOrderId,
            vendorId,
            status,
            subtotalAmount: 100_000n,
            shippingAmount: 0n,
            currency: 'VND',
            shippingAddress: {},
            items: {
              create: variantIds.map((variantId) => ({
                id: ulid(),
                variantId,
                productTitleSnapshot: 'Item',
                variantAttributesSnapshot: {},
                unitPriceAmount: 100_000n,
                quantity: 1,
                lineTotalAmount: 100_000n,
                currency: 'VND',
              })),
            },
          },
        },
      },
    });
    return subOrderId;
  }

  async function setup() {
    const { vendor } = await makeVendor(t.db);
    const product = await makeProduct(t.db, { vendorId: vendor.id });
    const other = await makeProduct(t.db, { vendorId: vendor.id });
    const customer = await makeUser(t.db, { name: 'Alice', email: 'alice-secret@example.com' });
    return { vendor, product, other, customer, variantId: product.variants[0]?.id ?? '' };
  }

  const post = async (
    user: Awaited<ReturnType<typeof makeUser>>,
    productId: string,
    payload: Record<string, unknown>,
  ) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/v1/products/${productId}/reviews`,
      headers: { ...(await t.authHeader(user)), 'idempotency-key': ulid() },
      payload,
    });
    return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
  };

  const list = async (productId: string, query = '') => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/products/${productId}/reviews${query}`,
    });
    return { status: res.statusCode, body: res.json<unknown>() };
  };

  it('creates a review and updates the summary in the list and the product detail', async () => {
    const { vendor, product, customer, variantId } = await setup();
    const second = await makeUser(t.db, { name: 'Nguyễn Văn An' });
    const so1 = await makeSubOrder(customer.id, vendor.id, [variantId]);
    const so2 = await makeSubOrder(second.id, vendor.id, [variantId], 'COMPLETED');

    const first = await post(customer, product.id, {
      subOrderId: so1,
      rating: 5,
      body: '  Great  ',
    });
    expect(first.status).toBe(201);
    const created = ReviewSchema.parse(first.body);
    expect(created).toMatchObject({ authorName: 'Alice', rating: 5, body: 'Great' });
    expect(JSON.stringify(first.body)).not.toContain('alice-secret');
    expect((await post(second, product.id, { subOrderId: so2, rating: 2 })).status).toBe(201);

    const res = await list(product.id);
    expect(res.status).toBe(200);
    const page = ReviewPageSchema.parse(res.body);
    expect(page.items.map((r) => r.authorName)).toEqual(['Nguyễn A.', 'Alice']); // newest first, masked
    expect(page.items[0]?.body).toBeNull();
    expect(page.summary).toEqual({ average: 3.5, count: 2, distribution: [0, 1, 0, 0, 1] });
    expect(page.nextCursor).toBeNull();

    const paged = ReviewPageSchema.parse((await list(product.id, '?limit=1')).body);
    expect(paged.items).toHaveLength(1);
    expect(paged.nextCursor).toBe(paged.items[0]?.id);
    const next = ReviewPageSchema.parse(
      (await list(product.id, `?limit=1&cursor=${paged.nextCursor}`)).body,
    );
    expect(next.items.map((r) => r.authorName)).toEqual(['Alice']);
    expect(next.nextCursor).toBeNull();

    const slug = product.translations[0]?.slug ?? '';
    const detail = await t.app.inject({ method: 'GET', url: `/v1/products/${slug}` });
    expect(ProductDetailSchema.parse(detail.json<unknown>()).rating).toEqual(page.summary);
  });

  it('rejects a sub-order that is not delivered', async () => {
    const { vendor, product, customer, variantId } = await setup();
    const so = await makeSubOrder(customer.id, vendor.id, [variantId], 'SHIPPED');
    const res = await post(customer, product.id, { subOrderId: so, rating: 4 });
    expect(res).toMatchObject({ status: 422, body: { errorCode: 'review.error.not-eligible' } });
  });

  it("rejects someone else's sub-order", async () => {
    const { vendor, product, customer, variantId } = await setup();
    const stranger = await makeUser(t.db);
    const so = await makeSubOrder(customer.id, vendor.id, [variantId]);
    const res = await post(stranger, product.id, { subOrderId: so, rating: 4 });
    expect(res).toMatchObject({ status: 422, body: { errorCode: 'review.error.not-eligible' } });
  });

  it('rejects a product that is not in the sub-order', async () => {
    const { vendor, other, customer, variantId } = await setup();
    const so = await makeSubOrder(customer.id, vendor.id, [variantId]);
    const res = await post(customer, other.id, { subOrderId: so, rating: 4 });
    expect(res).toMatchObject({ status: 422, body: { errorCode: 'review.error.not-eligible' } });
  });

  it('rejects a duplicate review of the same product in the same sub-order', async () => {
    const { vendor, product, customer, variantId } = await setup();
    const so = await makeSubOrder(customer.id, vendor.id, [variantId]);
    expect((await post(customer, product.id, { subOrderId: so, rating: 4 })).status).toBe(201);
    const again = await post(customer, product.id, { subOrderId: so, rating: 1 });
    expect(again).toMatchObject({
      status: 409,
      body: { errorCode: 'review.error.already-exists' },
    });
    expect(await t.db.review.count()).toBe(1);
  });

  it.each([0, 6])('rejects rating %i with 422', async (rating) => {
    const { vendor, product, customer, variantId } = await setup();
    const so = await makeSubOrder(customer.id, vendor.id, [variantId]);
    expect((await post(customer, product.id, { subOrderId: so, rating })).status).toBe(422);
  });

  it('requires authentication', async () => {
    const { product } = await setup();
    const res = await t.app.inject({
      method: 'POST',
      url: `/v1/products/${product.id}/reviews`,
      headers: { 'idempotency-key': ulid() },
      payload: { subOrderId: ulid(), rating: 5 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 on the list of a hidden or unknown product', async () => {
    const { vendor } = await setup();
    const draft = await makeProduct(t.db, { vendorId: vendor.id, status: 'DRAFT' });
    const suspended = await makeVendor(t.db, { status: 'SUSPENDED' });
    const hiddenByVendor = await makeProduct(t.db, { vendorId: suspended.vendor.id });
    for (const id of [draft.id, hiddenByVendor.id, ulid()]) {
      expect(await list(id)).toMatchObject({
        status: 404,
        body: { errorCode: 'product.error.not-found' },
      });
    }
  });
});
