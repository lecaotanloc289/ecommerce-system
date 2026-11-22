import {
  ProductDetailSchema,
  ProductSummaryPageSchema,
  ShippingMethodSchema,
  VendorProductPageSchema,
  VendorProductSchema,
  VendorProductVariantSchema,
  type VendorProduct,
} from '@repo/core';
import { ulid } from 'ulid';
import {
  type TestApp,
  createTestApp,
  makeCategory,
  makePlatformSettings,
  makeProduct,
  makeShippingMethod,
  makeUser,
  makeVendor,
} from '../support';

interface VariantBody {
  id?: string;
  sku: string;
  attributes: Record<string, string>;
  price: { amount: number; currency: string };
  stockOnHand: number;
}

describe('vendor catalog API (Testcontainers)', () => {
  let t: TestApp;
  let categoryId: string;
  let vendorId: string;
  let owner: { id: string };
  let headers: Record<string, string>;
  let otherVendorId: string;
  let otherHeaders: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    await makePlatformSettings(t.db);
    categoryId = (await makeCategory(t.db)).id;
    const a = await makeVendor(t.db);
    vendorId = a.vendor.id;
    owner = a.owner;
    headers = await t.authHeader(a.owner);
    const b = await makeVendor(t.db);
    otherVendorId = b.vendor.id;
    otherHeaders = await t.authHeader(b.owner);
  });

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    payload?: object,
    auth: Record<string, string> = headers,
  ) =>
    t.app.inject({
      method,
      url,
      headers: method === 'GET' ? auth : { ...auth, 'idempotency-key': ulid() },
      ...(payload && { payload }),
    });

  const word = (): string => ulid().toLowerCase();

  function body(
    overrides: {
      name?: string;
      slug?: string;
      variants?: VariantBody[];
      images?: object[];
      categoryIds?: string[];
    } = {},
  ) {
    const slug = overrides.slug ?? `p-${word()}`;
    return {
      translations: [
        { locale: 'VI', name: overrides.name ?? 'Áo khoác', slug },
        { locale: 'EN', name: overrides.name ?? 'Jacket', slug: `${slug}-en` },
      ],
      basePrice: { amount: 999, currency: 'VND' },
      variants: overrides.variants ?? [
        {
          sku: `SKU-${word()}`,
          attributes: { size: 'M' },
          price: { amount: 200_000, currency: 'VND' },
          stockOnHand: 5,
        },
      ],
      images: overrides.images ?? [],
      categoryIds: overrides.categoryIds ?? [categoryId],
    };
  }

  async function createProduct(over: Parameters<typeof body>[0] = {}): Promise<VendorProduct> {
    const res = await call('POST', '/v1/vendor/products', body(over));
    expect(res.statusCode).toBe(201);
    return VendorProductSchema.parse(res.json<unknown>());
  }

  const code = (res: { json<T>(): T }): string => res.json<{ errorCode: string }>().errorCode;

  it('creates a DRAFT (hidden), publishes it, and the public catalog + search see it', async () => {
    const name = `zebrafish${word().slice(-6)}`;
    const slug = `slug-${word()}`;
    const created = await createProduct({ name, slug });
    expect(created.status).toBe('DRAFT');
    expect(created.vendorId).toBe(vendorId);
    expect(created.translations).toHaveLength(2);
    expect(created.variants[0]).toMatchObject({ stockOnHand: 5, stockReserved: 0 });
    // basePrice mirrors the lowest variant price, not the client-sent value.
    expect(created.basePrice).toEqual({ amount: 200_000, currency: 'VND' });

    const hidden = await t.app.inject({ method: 'GET', url: `/v1/products/${slug}` });
    expect(hidden.statusCode).toBe(404);

    const published = await call('POST', `/v1/vendor/products/${created.id}/publish`);
    expect(published.statusCode).toBe(200);
    expect(VendorProductSchema.parse(published.json<unknown>()).status).toBe('ACTIVE');

    const detail = await t.app.inject({ method: 'GET', url: `/v1/products/${slug}` });
    expect(detail.statusCode).toBe(200);
    expect(ProductDetailSchema.parse(detail.json<unknown>()).id).toBe(created.id);

    const search = async (q: string) => {
      const res = await t.app.inject({ method: 'GET', url: `/v1/search?q=${q}` });
      return ProductSummaryPageSchema.parse(res.json<unknown>()).items.map((i) => i.id);
    };
    expect(await search(name)).toContain(created.id);

    // Renaming through PUT is reflected by search (the tsvector is a generated column).
    const renamed = `quokkafur${word().slice(-6)}`;
    const put = await call(
      'PUT',
      `/v1/vendor/products/${created.id}`,
      body({
        name: renamed,
        slug,
        variants: [{ ...variantOf(created, 0), price: { amount: 200_000, currency: 'VND' } }],
      }),
    );
    expect(put.statusCode).toBe(200);
    expect(await search(renamed)).toContain(created.id);
    expect(await search(name)).not.toContain(created.id);
  });

  function variantOf(product: VendorProduct, index: number): VariantBody {
    const v = product.variants[index];
    if (!v) throw new Error('no variant');
    return {
      id: v.id,
      sku: v.sku,
      attributes: v.attributes,
      price: v.price,
      stockOnHand: v.stockOnHand,
    };
  }

  it('keeps basePrice = MIN(variant price) on PUT so the public price filter works', async () => {
    const created = await createProduct();
    await call('POST', `/v1/vendor/products/${created.id}/publish`);
    const put = await call(
      'PUT',
      `/v1/vendor/products/${created.id}`,
      body({
        slug: created.translations[0]?.slug ?? '',
        variants: [
          { ...variantOf(created, 0), price: { amount: 200_000, currency: 'VND' } },
          {
            sku: `SKU-${word()}`,
            attributes: { size: 'L' },
            price: { amount: 150_000, currency: 'VND' },
            stockOnHand: 2,
          },
        ],
      }),
    );
    expect(put.statusCode).toBe(200);
    expect(VendorProductSchema.parse(put.json<unknown>()).basePrice.amount).toBe(150_000);

    const list = await t.app.inject({ method: 'GET', url: '/v1/products?maxPrice=160000' });
    const page = ProductSummaryPageSchema.parse(list.json<unknown>());
    expect(page.items.find((i) => i.id === created.id)?.basePrice.amount).toBe(150_000);
  });

  it('lists own products with a status filter and cursor', async () => {
    const a = await createProduct();
    await createProduct();
    await createProduct();
    await call('POST', `/v1/vendor/products/${a.id}/publish`);
    await makeProduct(t.db, { vendorId: otherVendorId });

    const all = VendorProductPageSchema.parse(
      (await call('GET', '/v1/vendor/products?limit=2')).json<unknown>(),
    );
    expect(all.items).toHaveLength(2);
    expect(all.nextCursor).not.toBeNull();
    const next = VendorProductPageSchema.parse(
      (await call('GET', `/v1/vendor/products?limit=2&cursor=${all.nextCursor}`)).json<unknown>(),
    );
    expect(next.items).toHaveLength(1);
    expect(next.nextCursor).toBeNull();

    const active = VendorProductPageSchema.parse(
      (await call('GET', '/v1/vendor/products?status=ACTIVE')).json<unknown>(),
    );
    expect(active.items.map((i) => i.id)).toEqual([a.id]);
    expect(active.items[0]).toMatchObject({ name: 'Áo khoác', variantCount: 1, stockOnHand: 5 });
  });

  it("treats another vendor's product, variant and shipping method as 404", async () => {
    const product = await makeProduct(t.db, { vendorId: otherVendorId, categoryIds: [categoryId] });
    const variant = product.variants[0];
    const method = await makeShippingMethod(t.db, { vendorId: otherVendorId });
    if (!variant) throw new Error('no variant');

    const results = await Promise.all([
      call('GET', `/v1/vendor/products/${product.id}`),
      call('PUT', `/v1/vendor/products/${product.id}`, body()),
      call('POST', `/v1/vendor/products/${product.id}/publish`),
      call('POST', `/v1/vendor/products/${product.id}/archive`),
      call('PATCH', `/v1/vendor/variants/${variant.id}/stock`, { stockOnHand: 1 }),
      call('PUT', `/v1/vendor/shipping-methods/${method.id}`, {
        name: 'x',
        price: { amount: 1, currency: 'VND' },
        estDays: 2,
        isActive: true,
      }),
      call('POST', `/v1/vendor/shipping-methods/${method.id}/deactivate`),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404, 404, 404]);

    const untouched = await t.db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(untouched.stockOnHand).toBe(10);
    expect(
      (await t.db.shippingMethod.findUniqueOrThrow({ where: { id: method.id } })).isActive,
    ).toBe(true);
  });

  it('rejects non-vendor callers', async () => {
    const customer = await makeUser(t.db);
    const res = await call('GET', '/v1/vendor/products', undefined, await t.authHeader(customer));
    expect(res.statusCode).toBe(403);
  });

  it('rejects a duplicate slug (409 conflict) and a duplicate sku across vendors', async () => {
    const first = await createProduct();
    const slug = first.translations[0]?.slug ?? '';
    const dupSlug = await call('POST', '/v1/vendor/products', body({ slug }));
    expect(dupSlug.statusCode).toBe(409);
    expect(code(dupSlug)).toBe('common.error.conflict');

    const sku = first.variants[0]?.sku ?? '';
    const dupSku = await call(
      'POST',
      '/v1/vendor/products',
      body({
        variants: [
          { sku, attributes: {}, price: { amount: 1000, currency: 'VND' }, stockOnHand: 1 },
        ],
      }),
      otherHeaders,
    );
    expect(dupSku.statusCode).toBe(409);
    expect(code(dupSku)).toBe('common.error.conflict');
    expect(await t.db.product.count({ where: { vendorId: otherVendorId } })).toBe(0);
  });

  it('rejects unknown categories, unsupported currency and foreign image keys', async () => {
    const badCategory = await call('POST', '/v1/vendor/products', body({ categoryIds: [ulid()] }));
    expect(badCategory.statusCode).toBe(422);

    await makePlatformSettings(t.db, {});
    await t.db.platformSettings.updateMany({ data: { supportedCurrencies: ['VND'] } });
    const usd = body();
    const usdBody = {
      ...usd,
      basePrice: { amount: 1, currency: 'USD' },
      variants: usd.variants.map((v) => ({ ...v, price: { amount: 100, currency: 'USD' } })),
    };
    expect((await call('POST', '/v1/vendor/products', usdBody)).statusCode).toBe(422);

    const foreignKey = `media/vendors/${otherVendorId}/${ulid()}.jpg`;
    const foreign = await call(
      'POST',
      '/v1/vendor/products',
      body({ images: [{ key: foreignKey, alt: null }] }),
    );
    expect(foreign.statusCode).toBe(422);
    expect(code(foreign)).toBe('upload.error.invalid-key');
  });

  it('stores own image keys as public URLs; the first image is primary', async () => {
    const k1 = `media/vendors/${vendorId}/${ulid()}.jpg`;
    const k2 = `media/vendors/${vendorId}/${ulid()}.png`;
    const created = await createProduct({
      images: [
        { key: k1, alt: 'one' },
        { key: k2, alt: null },
      ],
    });
    expect(created.images.map((i) => i.sortOrder)).toEqual([0, 1]);
    expect(created.images[0]?.url.endsWith(k1)).toBe(true);
    expect(created.primaryImageUrl).toBe(created.images[0]?.url);

    // Reorder + drop: keep the second by id, nothing else.
    const second = created.images[1];
    if (!second) throw new Error('no image');
    const put = await call(
      'PUT',
      `/v1/vendor/products/${created.id}`,
      body({
        slug: created.translations[0]?.slug ?? '',
        variants: [variantOf(created, 0)],
        images: [{ id: second.id, alt: 'two' }],
      }),
    );
    const updated = VendorProductSchema.parse(put.json<unknown>());
    expect(updated.images).toHaveLength(1);
    expect(updated.primaryImageUrl).toBe(second.url);
  });

  describe('publish', () => {
    it('needs a variant priced above zero', async () => {
      const created = await createProduct({
        variants: [
          {
            sku: `S-${word()}`,
            attributes: {},
            price: { amount: 0, currency: 'VND' },
            stockOnHand: 1,
          },
        ],
      });
      const res = await call('POST', `/v1/vendor/products/${created.id}/publish`);
      expect(res.statusCode).toBe(422);
      expect(code(res)).toBe('product.error.not-publishable');
    });

    it('needs a variant and a vi translation', async () => {
      const noVariant = await createProduct();
      await t.db.productVariant.deleteMany({ where: { productId: noVariant.id } });
      expect(code(await call('POST', `/v1/vendor/products/${noVariant.id}/publish`))).toBe(
        'product.error.not-publishable',
      );

      const noVi = await createProduct();
      await t.db.productTranslation.deleteMany({ where: { productId: noVi.id, locale: 'VI' } });
      expect(code(await call('POST', `/v1/vendor/products/${noVi.id}/publish`))).toBe(
        'product.error.not-publishable',
      );
    });

    it('refuses BLOCKED products for publish and archive', async () => {
      const created = await createProduct();
      await t.db.product.update({
        where: { id: created.id },
        data: { status: 'BLOCKED', blockedReason: 'counterfeit' },
      });
      for (const action of ['publish', 'archive']) {
        const res = await call('POST', `/v1/vendor/products/${created.id}/${action}`);
        expect(res.statusCode).toBe(409);
        expect(code(res)).toBe('product.error.blocked');
      }
      const read = VendorProductSchema.parse(
        (await call('GET', `/v1/vendor/products/${created.id}`)).json<unknown>(),
      );
      expect(read).toMatchObject({ status: 'BLOCKED', blockedReason: 'counterfeit' });
    });

    it('archives a published product out of the public catalog', async () => {
      const created = await createProduct();
      await call('POST', `/v1/vendor/products/${created.id}/publish`);
      const res = await call('POST', `/v1/vendor/products/${created.id}/archive`);
      expect(VendorProductSchema.parse(res.json<unknown>()).status).toBe('ARCHIVED');
      const slug = created.translations[0]?.slug ?? '';
      expect((await t.app.inject({ method: 'GET', url: `/v1/products/${slug}` })).statusCode).toBe(
        404,
      );
    });
  });

  describe('variants and stock', () => {
    it('rejects stock below the reserved quantity (PATCH and PUT) and accepts at/above it', async () => {
      const product = await makeProduct(t.db, {
        vendorId,
        categoryIds: [categoryId],
        variants: [{ stockOnHand: 10, stockReserved: 4 }],
      });
      const variant = product.variants[0];
      if (!variant) throw new Error('no variant');

      const low = await call('PATCH', `/v1/vendor/variants/${variant.id}/stock`, {
        stockOnHand: 3,
      });
      expect(low.statusCode).toBe(409);
      expect(code(low)).toBe('product.error.stock-below-reserved');

      const ok = await call('PATCH', `/v1/vendor/variants/${variant.id}/stock`, {
        stockOnHand: 4,
      });
      expect(ok.statusCode).toBe(200);
      expect(VendorProductVariantSchema.parse(ok.json<unknown>())).toMatchObject({
        stockOnHand: 4,
        stockReserved: 4,
      });

      const read = VendorProductSchema.parse(
        (await call('GET', `/v1/vendor/products/${product.id}`)).json<unknown>(),
      );
      const put = await call(
        'PUT',
        `/v1/vendor/products/${product.id}`,
        body({
          slug: read.translations[0]?.slug ?? '',
          variants: [{ ...variantOf(read, 0), stockOnHand: 2 }],
        }),
      );
      expect(put.statusCode).toBe(409);
      expect(code(put)).toBe('product.error.stock-below-reserved');
      // The failed PUT rolled back as a whole (stock unchanged).
      expect(
        (await t.db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stockOnHand,
      ).toBe(4);
    });

    it('never undercuts a concurrent checkout reservation', async () => {
      const product = await makeProduct(t.db, {
        vendorId,
        variants: [{ stockOnHand: 10, stockReserved: 0 }],
      });
      const variant = product.variants[0];
      if (!variant) throw new Error('no variant');
      for (let round = 0; round < 10; round += 1) {
        await t.db.productVariant.update({
          where: { id: variant.id },
          data: { stockOnHand: 10, stockReserved: 0 },
        });
        // Same statement checkout uses to reserve.
        const reserve = t.db
          .$executeRaw`UPDATE product_variants SET stock_reserved = stock_reserved + 6
          WHERE id = ${variant.id} AND stock_on_hand - stock_reserved >= 6`;
        const patch = call('PATCH', `/v1/vendor/variants/${variant.id}/stock`, { stockOnHand: 5 });
        await Promise.all([reserve, patch]);
        const row = await t.db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
        expect(row.stockReserved).toBeLessThanOrEqual(row.stockOnHand);
      }
    });

    it('matches variants by sku, and deletes removed ones only when never ordered or carted', async () => {
      const created = await createProduct({
        variants: [
          {
            sku: `A-${word()}`,
            attributes: {},
            price: { amount: 1000, currency: 'VND' },
            stockOnHand: 1,
          },
          {
            sku: `B-${word()}`,
            attributes: {},
            price: { amount: 2000, currency: 'VND' },
            stockOnHand: 1,
          },
        ],
      });
      const [a, b] = [variantOf(created, 0), variantOf(created, 1)];
      const slug = created.translations[0]?.slug ?? '';

      // Same sku without id → updates in place (same variant id).
      const bySku = await call(
        'PUT',
        `/v1/vendor/products/${created.id}`,
        body({
          slug,
          variants: [
            {
              sku: a.sku,
              attributes: {},
              price: { amount: 1500, currency: 'VND' },
              stockOnHand: 7,
            },
            b,
          ],
        }),
      );
      const afterSku = VendorProductSchema.parse(bySku.json<unknown>());
      expect(afterSku.variants.find((v) => v.sku === a.sku)).toMatchObject({
        id: a.id,
        stockOnHand: 7,
        price: { amount: 1500 },
      });
      expect(afterSku.basePrice.amount).toBe(1500);

      // Carted variant cannot be removed.
      const buyer = await makeUser(t.db);
      const cart = await t.db.cart.create({ data: { id: ulid(), userId: buyer.id } });
      await t.db.cartItem.create({
        data: { id: ulid(), cartId: cart.id, variantId: b.id ?? '', quantity: 1 },
      });
      const blocked = await call(
        'PUT',
        `/v1/vendor/products/${created.id}`,
        body({ slug, variants: [a] }),
      );
      expect(blocked.statusCode).toBe(409);
      expect(code(blocked)).toBe('product.error.variant-in-use');
      expect(await t.db.productVariant.count({ where: { productId: created.id } })).toBe(2);

      // Once unused it can go.
      await t.db.cartItem.deleteMany({});
      const removed = await call(
        'PUT',
        `/v1/vendor/products/${created.id}`,
        body({ slug, variants: [a] }),
      );
      expect(removed.statusCode).toBe(200);
      expect(await t.db.productVariant.count({ where: { productId: created.id } })).toBe(1);
    });
  });

  describe('vendor status', () => {
    it('blocks every write of a SUSPENDED vendor even with a stale token', async () => {
      const product = await makeProduct(t.db, { vendorId, categoryIds: [categoryId] });
      const variant = product.variants[0];
      if (!variant) throw new Error('no variant');
      await t.db.vendor.update({
        where: { id: vendorId },
        data: { status: 'SUSPENDED', suspendedReason: 'fraud' },
      });
      const stale = {
        authorization: `Bearer ${await t.signAccessToken(owner, ['VENDOR_OWNER'], vendorId)}`,
      };

      const attempts = await Promise.all([
        call('POST', '/v1/vendor/products', body(), stale),
        call('POST', `/v1/vendor/products/${product.id}/publish`, undefined, stale),
        call('PATCH', `/v1/vendor/variants/${variant.id}/stock`, { stockOnHand: 1 }, stale),
        call(
          'POST',
          '/v1/vendor/shipping-methods',
          { name: 'x', price: { amount: 1, currency: 'VND' }, estDays: 2 },
          stale,
        ),
      ]);
      for (const res of attempts) {
        expect(res.statusCode).toBe(403);
        expect(code(res)).toBe('vendor.error.suspended');
      }
      // Reads stay available.
      expect((await call('GET', '/v1/vendor/products', undefined, stale)).statusCode).toBe(200);
    });

    it('reports a PENDING vendor as not active', async () => {
      await t.db.vendor.update({ where: { id: vendorId }, data: { status: 'PENDING' } });
      const stale = {
        authorization: `Bearer ${await t.signAccessToken(owner, ['VENDOR_OWNER'], vendorId)}`,
      };
      const res = await call('POST', '/v1/vendor/products', body(), stale);
      expect(code(res)).toBe('vendor.error.not-active');
    });
  });

  describe('shipping methods', () => {
    it('creates, lists, replaces and deactivates own methods', async () => {
      await makeShippingMethod(t.db, { vendorId: otherVendorId });
      const created = await call('POST', '/v1/vendor/shipping-methods', {
        name: 'Express',
        price: { amount: 50_000, currency: 'VND' },
        estDays: 1,
      });
      expect(created.statusCode).toBe(201);
      const method = ShippingMethodSchema.parse(created.json<unknown>());
      expect(method).toMatchObject({ vendorId, isActive: true, estDays: 1 });

      const put = await call('PUT', `/v1/vendor/shipping-methods/${method.id}`, {
        name: 'Express+',
        price: { amount: 60_000, currency: 'VND' },
        estDays: 2,
        isActive: true,
      });
      expect(ShippingMethodSchema.parse(put.json<unknown>())).toMatchObject({
        name: 'Express+',
        price: { amount: 60_000 },
      });

      const off = await call('POST', `/v1/vendor/shipping-methods/${method.id}/deactivate`);
      expect(ShippingMethodSchema.parse(off.json<unknown>()).isActive).toBe(false);

      const list = (await call('GET', '/v1/vendor/shipping-methods')).json<{ id: string }[]>();
      expect(list.map((m) => m.id)).toEqual([method.id]);
    });
  });
});
