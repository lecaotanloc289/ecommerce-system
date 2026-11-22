import {
  CategoryDetailSchema,
  CategoryTreeSchema,
  PlatformSettingsPublicSchema,
  ProductDetailSchema,
  ProductSummaryPageSchema,
  VendorDetailSchema,
  type ProductSummaryPage,
} from '@repo/core';
import { monotonicFactory } from 'ulid';
import {
  type TestApp,
  createTestApp,
  makeCategory,
  makePlatformSettings,
  makeProduct,
  makeUser,
  makeVendor,
} from '../support';

const ulid = monotonicFactory();

describe('public catalog API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const get = async (url: string) => {
    const res = await t.app.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json<unknown>() };
  };
  const getPage = async (url: string): Promise<ProductSummaryPage> => {
    const res = await get(url);
    expect(res.status).toBe(200);
    return ProductSummaryPageSchema.parse(res.body);
  };

  /** Gives a product's vi/en translations explicit names + slugs (the factory uses random slugs). */
  async function rename(
    productId: string,
    vi: { name: string; slug: string },
    en?: { name: string; slug: string },
  ) {
    await t.db.productTranslation.update({
      where: { productId_locale: { productId, locale: 'VI' } },
      data: vi,
    });
    await t.db.productTranslation.update({
      where: { productId_locale: { productId, locale: 'EN' } },
      data: en ?? vi,
    });
  }

  /** Inserts reviews bypassing FK checks (sub-orders are out of scope here). */
  async function addReviews(productId: string, ratings: readonly number[]) {
    const author = await makeUser(t.db);
    await t.db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      for (const rating of ratings) {
        const id = ulid();
        await tx.$executeRaw`INSERT INTO reviews (id, product_id, author_id, sub_order_id, rating, updated_at)
          VALUES (${id}, ${productId}, ${author.id}, ${id}, ${rating}, now())`;
      }
    });
  }

  describe('categories', () => {
    it('returns the tree in the requested locale and detail with breadcrumb', async () => {
      const root = await makeCategory(t.db, { name: 'Fashion' });
      const child = await makeCategory(t.db, { name: 'Shirts', parentId: root.id });
      const grand = await makeCategory(t.db, { name: 'Polo', parentId: child.id });

      const tree = CategoryTreeSchema.parse((await get('/v1/categories?locale=en')).body);
      expect(tree.items).toHaveLength(1);
      expect(tree.items[0]).toMatchObject({ id: root.id, name: 'Fashion' });
      expect(tree.items[0]?.children[0]?.children[0]).toMatchObject({ id: grand.id });
      const vi = CategoryTreeSchema.parse((await get('/v1/categories')).body);
      expect(vi.items[0]?.name).toBe('Fashion (vi)');

      const slug = grand.translations[0]?.slug ?? '';
      const detail = CategoryDetailSchema.parse((await get(`/v1/categories/${slug}`)).body);
      expect(detail.breadcrumb.map((c) => c.id)).toEqual([root.id, child.id, grand.id]);
      expect(detail.children).toEqual([]);
    });

    it('unknown slug → 404', async () => {
      const res = await get('/v1/categories/nope');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ errorCode: 'common.error.not-found' });
    });
  });

  describe('products', () => {
    it('hides DRAFT / ARCHIVED / BLOCKED products and products of SUSPENDED vendors', async () => {
      const { vendor } = await makeVendor(t.db);
      const { vendor: suspended } = await makeVendor(t.db, { status: 'SUSPENDED' });
      const visible = await makeProduct(t.db, { vendorId: vendor.id });
      const hidden = [
        await makeProduct(t.db, { vendorId: vendor.id, status: 'DRAFT' }),
        await makeProduct(t.db, { vendorId: vendor.id, status: 'ARCHIVED' }),
        await makeProduct(t.db, { vendorId: vendor.id, status: 'BLOCKED' }),
        await makeProduct(t.db, { vendorId: suspended.id }),
      ];

      const page = await getPage('/v1/products');
      expect(page.items.map((p) => p.id)).toEqual([visible.id]);
      for (const product of hidden) {
        const slug = product.translations[0]?.slug ?? '';
        const res = await get(`/v1/products/${slug}`);
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ errorCode: 'product.error.not-found' });
      }
      expect((await get('/v1/products/unknown-slug')).body).toMatchObject({
        errorCode: 'product.error.not-found',
      });
      expect((await get(`/v1/vendors/${suspended.slug}`)).status).toBe(404);
    });

    it('filters by category (incl. subcategories), vendor and price range', async () => {
      const { vendor: v1 } = await makeVendor(t.db);
      const { vendor: v2 } = await makeVendor(t.db);
      const parent = await makeCategory(t.db);
      const child = await makeCategory(t.db, { parentId: parent.id });
      const other = await makeCategory(t.db);
      const inChild = await makeProduct(t.db, {
        vendorId: v1.id,
        categoryIds: [child.id],
        price: 100,
      });
      const inParent = await makeProduct(t.db, {
        vendorId: v2.id,
        categoryIds: [parent.id],
        price: 500,
      });
      await makeProduct(t.db, { vendorId: v1.id, categoryIds: [other.id], price: 300 });

      const slug = parent.translations[0]?.slug ?? '';
      const byCat = await getPage(`/v1/products?categorySlug=${slug}`);
      expect(byCat.items.map((p) => p.id).sort()).toEqual([inChild.id, inParent.id].sort());
      expect((await getPage('/v1/products?categorySlug=missing')).items).toEqual([]);

      const byVendor = await getPage(`/v1/products?vendorSlug=${v2.slug}`);
      expect(byVendor.items.map((p) => p.id)).toEqual([inParent.id]);

      const byPrice = await getPage('/v1/products?minPrice=200&maxPrice=400');
      expect(byPrice.items).toHaveLength(1);
      expect(byPrice.items[0]?.basePrice).toEqual({ amount: 300, currency: 'VND' });
      expect((await get('/v1/products?minPrice=9&maxPrice=1')).status).toBe(422);
    });

    it('resolves locale with fallback to vi', async () => {
      const { vendor } = await makeVendor(t.db);
      const product = await makeProduct(t.db, { vendorId: vendor.id, name: 'Shirt' });
      const slug = product.translations[0]?.slug ?? '';
      expect((await getPage('/v1/products?locale=en')).items[0]?.name).toBe('Shirt');
      expect((await getPage('/v1/products')).items[0]?.name).toBe('Shirt (vi)');

      await t.db.productTranslation.delete({
        where: { productId_locale: { productId: product.id, locale: 'EN' } },
      });
      expect((await getPage('/v1/products?locale=en')).items[0]?.name).toBe('Shirt (vi)');
      const detail = ProductDetailSchema.parse((await get(`/v1/products/${slug}?locale=en`)).body);
      expect(detail.name).toBe('Shirt (vi)');
    });

    it('detail exposes stockAvailable, vendor and rating summary but no raw stock', async () => {
      const { vendor } = await makeVendor(t.db, { displayName: 'Shop A' });
      const product = await makeProduct(t.db, {
        vendorId: vendor.id,
        variants: [
          { stockOnHand: 10, stockReserved: 3, attributes: { size: 'M' } },
          { stockOnHand: 2, stockReserved: 2 },
        ],
      });
      await addReviews(product.id, [5, 4, 4]);
      const slug = product.translations[0]?.slug ?? '';

      const res = await get(`/v1/products/${slug}`);
      const detail = ProductDetailSchema.parse(res.body);
      expect(detail.variants.map((v) => v.stockAvailable)).toEqual([7, 0]);
      expect(detail.variants[0]?.attributes).toEqual({ size: 'M' });
      expect(detail.vendor).toMatchObject({ id: vendor.id, displayName: 'Shop A' });
      expect(detail.rating).toEqual({ average: 4.33, count: 3, distribution: [0, 0, 0, 2, 1] });
      expect(JSON.stringify(res.body)).not.toMatch(/stockOnHand|stockReserved/);

      const bare = await makeProduct(t.db, { vendorId: vendor.id });
      const none = ProductDetailSchema.parse(
        (await get(`/v1/products/${bare.translations[0]?.slug ?? ''}`)).body,
      );
      expect(none.rating).toEqual({ average: null, count: 0, distribution: [0, 0, 0, 0, 0] });
    });

    it('newest-first pagination is stable and complete', async () => {
      const { vendor } = await makeVendor(t.db);
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1)
        created.push((await makeProduct(t.db, { vendorId: vendor.id })).id);

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 6; guard += 1) {
        const page = await getPage(`/v1/products?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...page.items.map((p) => p.id));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual([...created].reverse());
    });

    it('sorts by price and rating with keyset pagination across ties', async () => {
      const { vendor } = await makeVendor(t.db);
      const prices = [300, 100, 200, 100, 200];
      const products = [];
      for (const price of prices)
        products.push(await makeProduct(t.db, { vendorId: vendor.id, price }));
      const [p300, p100a, p200a, p100b, p200b] = products;
      if (!p300 || !p100a || !p200a || !p100b || !p200b) throw new Error('setup');
      await addReviews(p300.id, [5, 5]);
      await addReviews(p100a.id, [3]);

      const walk = async (sort: string) => {
        const seen: string[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 6; guard += 1) {
          const page: ProductSummaryPage = await getPage(
            `/v1/products?sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
          );
          seen.push(...page.items.map((p) => p.id));
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        return seen;
      };
      // ties break newest first
      expect(await walk('price_asc')).toEqual([p100b.id, p100a.id, p200b.id, p200a.id, p300.id]);
      expect(await walk('price_desc')).toEqual([p300.id, p200b.id, p200a.id, p100b.id, p100a.id]);
      // rated first (5.0, 3.0), then unrated products newest first
      expect(await walk('rating')).toEqual([p300.id, p100a.id, p200b.id, p100b.id, p200a.id]);
    });
  });

  describe('search', () => {
    it('matches accented and unaccented Vietnamese, hides non-visible products', async () => {
      const { vendor } = await makeVendor(t.db);
      const { vendor: suspended } = await makeVendor(t.db, { status: 'SUSPENDED' });
      const shirt = await makeProduct(t.db, { vendorId: vendor.id });
      const shoes = await makeProduct(t.db, { vendorId: vendor.id });
      const draft = await makeProduct(t.db, { vendorId: vendor.id, status: 'DRAFT' });
      const foreign = await makeProduct(t.db, { vendorId: suspended.id });
      await rename(
        shirt.id,
        { name: 'Áo thun cổ tròn', slug: 'ao-thun-co-tron' },
        { name: 'Round neck tee', slug: 'round-neck-tee' },
      );
      await rename(shoes.id, { name: 'Giày thể thao', slug: 'giay-the-thao' });
      await rename(draft.id, { name: 'Áo thun nháp', slug: 'ao-thun-nhap' });
      await rename(foreign.id, { name: 'Áo thun khác', slug: 'ao-thun-khac' });

      const ids = async (q: string, locale = 'vi') =>
        (await getPage(`/v1/search?q=${encodeURIComponent(q)}&locale=${locale}`)).items.map(
          (p) => p.id,
        );
      expect(await ids('áo thun')).toEqual([shirt.id]);
      expect(await ids('ao thun')).toEqual([shirt.id]);
      expect(await ids('AO THUN')).toEqual([shirt.id]);
      expect(await ids('giày')).toEqual([shoes.id]);
      expect(await ids('giay the')).toEqual([shoes.id]);
      expect(await ids('round neck', 'en')).toEqual([shirt.id]);
      expect(await ids('xyzzy')).toEqual([]);
      expect((await get('/v1/search')).status).toBe(422);
      expect((await get('/v1/search?q=%25_%5C')).status).toBe(200);
    });

    it('paginates ranked results without gaps or repeats', async () => {
      const { vendor } = await makeVendor(t.db);
      const names = ['Áo thun đỏ', 'Áo thun xanh', 'Áo thun', 'Áo thun vàng trắng', 'Áo thun cam'];
      const made: string[] = [];
      for (const [i, name] of names.entries()) {
        const p = await makeProduct(t.db, { vendorId: vendor.id });
        await rename(p.id, { name, slug: `ao-thun-${i}` });
        made.push(p.id);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 6; guard += 1) {
        const page: ProductSummaryPage = await getPage(
          `/v1/search?q=${encodeURIComponent('áo thun')}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...page.items.map((p) => p.id));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect([...seen].sort()).toEqual([...made].sort());
      expect(new Set(seen).size).toBe(seen.length);
    });
  });

  describe('vendors and settings', () => {
    it('vendor page returns the shop and only its visible products', async () => {
      const { vendor } = await makeVendor(t.db, { displayName: 'Shop A' });
      const { vendor: other } = await makeVendor(t.db);
      const mine = await makeProduct(t.db, { vendorId: vendor.id });
      await makeProduct(t.db, { vendorId: vendor.id, status: 'DRAFT' });
      await makeProduct(t.db, { vendorId: other.id });

      const res = await get(`/v1/vendors/${vendor.slug}`);
      const body = VendorDetailSchema.parse(res.body);
      expect(body).toMatchObject({ id: vendor.id, displayName: 'Shop A' });
      expect(body.products.items.map((p) => p.id)).toEqual([mine.id]);
      expect(JSON.stringify(res.body)).not.toMatch(/commission|status/i);

      const missing = await get('/v1/vendors/nope');
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ errorCode: 'vendor.error.not-found' });
    });

    it('platform settings public', async () => {
      await makePlatformSettings(t.db, { maxCouponStack: 2 });
      const settings = PlatformSettingsPublicSchema.parse(
        (await get('/v1/platform-settings/public')).body,
      );
      expect(settings).toEqual({
        supportedCurrencies: ['VND', 'USD'],
        defaultCurrency: 'VND',
        maxCouponStack: 2,
      });
    });
  });
});
