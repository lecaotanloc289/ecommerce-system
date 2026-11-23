import {
  CrmAutomationSchema,
  CrmCampaignPageSchema,
  CrmCampaignPreviewSchema,
  CrmCampaignSchema,
  CrmCustomerDetailSchema,
  CrmCustomerPageSchema,
  type CrmCustomerSummary,
  CrmSegmentCountsSchema,
  type CustomerSegment,
  CustomerSegmentSchema,
  type SubOrderStatus,
  classifyCustomer,
} from '@repo/core';
import { monotonicFactory } from 'ulid';
import { CrmCustomersRepository } from '../../src/crm/crm-customers.repository';
import { exceedsWeeklyLimit } from '../../src/crm/crm-campaigns.service';
import {
  type TestApp,
  createTestApp,
  makeCoupon,
  makePlatformSettings,
  makeProduct,
  makeUser,
  makeVendor,
} from '../support';
import type { Db } from '../support/test-app';

const ulid = monotonicFactory();
const DAY = 86_400_000;
const THRESHOLDS = { atRiskAfterDays: 60, lapsedAfterDays: 180, vipMinOrders: 3 };

interface ErrorBody {
  errorCode: string;
  params: Record<string, unknown>;
}

interface OrderSpec {
  customerId: string;
  vendorId: string;
  variantId: string;
  status?: SubOrderStatus;
  at: Date;
  subtotal?: number;
  shipping?: number;
  discount?: number;
  platformDiscount?: number;
  currency?: 'VND' | 'USD';
  city?: string;
}

/** Order + one sub-order straight into the DB (as if checkout + payment had run) at `at`. */
async function makeSubOrder(db: Db, spec: OrderSpec): Promise<string> {
  const currency = spec.currency ?? 'VND';
  const orderId = ulid();
  const subOrderId = ulid();
  const subtotal = BigInt(spec.subtotal ?? 200_000);
  await db.order.create({
    data: {
      id: orderId,
      customerId: spec.customerId,
      status: 'PAID',
      currency,
      itemsTotalAmount: subtotal,
      shippingTotalAmount: 0n,
      grandTotalAmount: 0n,
      idempotencyKey: ulid(),
      createdAt: spec.at,
    },
  });
  await db.subOrder.create({
    data: {
      id: subOrderId,
      orderId,
      vendorId: spec.vendorId,
      status: spec.status ?? 'COMPLETED',
      subtotalAmount: subtotal,
      shippingAmount: BigInt(spec.shipping ?? 30_000),
      discountAmount: BigInt(spec.discount ?? 0),
      platformDiscountAmount: BigInt(spec.platformDiscount ?? 0),
      commissionAmount: 0n,
      currency,
      createdAt: spec.at,
      shippingAddress: {
        recipientName: 'Nguyễn Văn A',
        phone: '0901234567',
        line1: '1 Lê Lợi',
        line2: null,
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: spec.city ?? 'Hồ Chí Minh',
        country: 'VN',
      },
      items: {
        create: {
          id: ulid(),
          variantId: spec.variantId,
          productTitleSnapshot: 'Áo thun',
          variantAttributesSnapshot: {},
          unitPriceAmount: subtotal,
          quantity: 1,
          lineTotalAmount: subtotal,
          currency,
        },
      },
    },
  });
  return subOrderId;
}

async function optIn(db: Db, userId: string, vendorId: string, at = new Date()): Promise<void> {
  await db.customerVendorPreference.create({
    data: {
      userId,
      vendorId,
      marketingOptInAt: at,
      marketingOptInSource: 'STOREFRONT',
      unsubscribeTokenHash: ulid(),
    },
  });
}

describe('vendor CRM (Testcontainers)', () => {
  let t: TestApp;
  let vendorId: string;
  let variantId: string;
  let productId: string;
  let otherVendorId: string;
  let otherVariantId: string;
  let owner: Record<string, string>;
  let staff: Record<string, string>;
  let staffId: string;
  let otherOwner: Record<string, string>;

  const ago = (days: number, extraMs = 0): Date => new Date(Date.now() - days * DAY - extraMs);

  async function call(
    headers: Record<string, string>,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) {
    return t.app.inject({
      method,
      url: `/v1${url}`,
      headers: method === 'GET' ? headers : { ...headers, 'idempotency-key': ulid() },
      ...(payload !== undefined && { payload }),
    });
  }

  async function customer(name = 'Khách') {
    return makeUser(t.db, { name });
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    await makePlatformSettings(t.db);
    const a = await makeVendor(t.db, { displayName: 'Shop A' });
    vendorId = a.vendor.id;
    owner = await t.authHeader(a.owner);
    const product = await makeProduct(t.db, { vendorId });
    productId = product.id;
    variantId = product.variants[0]?.id ?? '';
    const s = await makeUser(t.db, { roles: ['CUSTOMER', 'VENDOR_STAFF'], vendorId });
    staffId = s.id;
    staff = await t.authHeader(s);
    const b = await makeVendor(t.db);
    otherVendorId = b.vendor.id;
    otherOwner = await t.authHeader(b.owner);
    otherVariantId = (await makeProduct(t.db, { vendorId: otherVendorId })).variants[0]?.id ?? '';
  });

  async function listAll(query = ''): Promise<CrmCustomerSummary[]> {
    const res = await call(owner, 'GET', `/vendor/crm/customers?limit=100${query}`);
    expect(res.statusCode).toBe(200);
    return CrmCustomerPageSchema.parse(res.json()).items;
  }

  describe('customers + segments', () => {
    it('computes stats and segments on valid orders only, matching classifyCustomer', async () => {
      const newC = await customer('New');
      await makeSubOrder(t.db, { customerId: newC.id, vendorId, variantId, at: ago(10) });

      const returning = await customer('Returning');
      for (const d of [40, 20]) {
        await makeSubOrder(t.db, { customerId: returning.id, vendorId, variantId, at: ago(d) });
      }

      const vip = await customer('Vip');
      for (const d of [50, 30, 5]) {
        await makeSubOrder(t.db, {
          customerId: vip.id,
          vendorId,
          variantId,
          at: ago(d),
          subtotal: 100_000,
          shipping: 30_000,
          discount: 5_000,
          platformDiscount: 10_000,
        });
      }
      // Refunded / cancelled / unpaid never count — not even as the latest order.
      for (const status of ['REFUNDED', 'CANCELLED', 'AWAITING_PAYMENT'] as const) {
        await makeSubOrder(t.db, { customerId: vip.id, vendorId, variantId, status, at: ago(1) });
      }

      const atRisk = await customer('AtRisk');
      for (const d of [100, 70]) {
        await makeSubOrder(t.db, { customerId: atRisk.id, vendorId, variantId, at: ago(d) });
      }
      await makeSubOrder(t.db, {
        customerId: atRisk.id,
        vendorId,
        variantId,
        status: 'CANCELLED',
        at: ago(2),
      });

      const lapsed = await customer('Lapsed');
      await makeSubOrder(t.db, { customerId: lapsed.id, vendorId, variantId, at: ago(200) });

      const onlyInvalid = await customer('Invalid');
      for (const status of ['REFUNDED', 'CANCELLED', 'AWAITING_PAYMENT'] as const) {
        await makeSubOrder(t.db, {
          customerId: onlyInvalid.id,
          vendorId,
          variantId,
          status,
          at: ago(3),
        });
      }

      const items = await listAll();
      const now = new Date();
      const byId = new Map<string, CrmCustomerSummary>(items.map((i) => [i.customerId, i]));
      expect(byId.has(onlyInvalid.id)).toBe(false);
      expect(items).toHaveLength(5);
      const expected: [string, CustomerSegment, number][] = [
        [newC.id, 'NEW', 1],
        [returning.id, 'RETURNING', 2],
        [vip.id, 'VIP', 3],
        [atRisk.id, 'AT_RISK', 2],
        [lapsed.id, 'LAPSED', 1],
      ];
      for (const [id, segment, orderCount] of expected) {
        const item = byId.get(id);
        expect(item?.segment).toBe(segment);
        expect(item?.orderCount).toBe(orderCount);
        if (!item) continue;
        expect(classifyCustomer(item, now, THRESHOLDS)).toBe(segment);
      }
      // C2: Σ (subtotal + shipping − discount − platformDiscount) = 3 × 115 000
      expect(byId.get(vip.id)?.spend).toEqual([{ amount: 345_000, currency: 'VND' }]);
      // lastOrderAt ignores the newer refunded / cancelled / unpaid sub-orders
      const vipLast = byId.get(vip.id)?.lastOrderAt ?? '';
      expect(Date.now() - new Date(vipLast).getTime()).toBeGreaterThan(4 * DAY);

      const seg = await call(staff, 'GET', '/vendor/crm/segments');
      expect(seg.statusCode).toBe(200);
      const counts = CrmSegmentCountsSchema.parse(seg.json());
      expect(counts.totalCustomers).toBe(5);
      expect(counts.segments.map((s) => [s.segment, s.customers])).toEqual([
        ['NEW', 1],
        ['RETURNING', 1],
        ['VIP', 1],
        ['AT_RISK', 1],
        ['LAPSED', 1],
      ]);
    });

    it('SQL segments agree with classifyCustomer at the exact boundaries (fixed now)', async () => {
      const repo = t.app.get(CrmCustomersRepository);
      const now = new Date('2026-11-23T00:00:00.000Z');
      const at = (days: number, ms = 0) => new Date(now.getTime() - days * DAY - ms);
      // [days ago, extra ms, number of orders]
      const fixtures: [number, number, number][] = [
        [60, 0, 1], // exactly 60 days → not yet AT_RISK
        [60, 1, 1], // 60 days + 1 ms → AT_RISK
        [180, 0, 3], // exactly 180 days → AT_RISK
        [180, 1, 1], // → LAPSED
        [59, 0, 2], // RETURNING
        [1, 0, 3], // VIP
        [0, 0, 1], // NEW
        [61, 0, 5], // AT_RISK beats VIP
        [-1, 0, 1], // future (clock skew) → NEW
      ];
      const ids: string[] = [];
      for (const [days, ms, n] of fixtures) {
        const c = await customer();
        ids.push(c.id);
        // the latest order is the fixture instant; older ones are a day apart before it
        for (let i = n - 1; i >= 0; i -= 1) {
          await makeSubOrder(t.db, {
            customerId: c.id,
            vendorId,
            variantId,
            at: at(days + i, ms),
          });
        }
      }

      const rows = await repo.customers(
        t.db,
        vendorId,
        {},
        { sort: 'last_order', after: null, limit: 100 },
        now,
        THRESHOLDS,
      );
      expect(rows).toHaveLength(fixtures.length);
      for (const row of rows) {
        expect({ id: row.customerId, segment: row.segment }).toEqual({
          id: row.customerId,
          segment: classifyCustomer(row, now, THRESHOLDS),
        });
      }
      const segmentOf = (i: number) => rows.find((r) => r.customerId === ids[i])?.segment;
      expect(fixtures.map((_, i) => segmentOf(i))).toEqual([
        'NEW',
        'AT_RISK',
        'AT_RISK',
        'LAPSED',
        'RETURNING',
        'VIP',
        'NEW',
        'AT_RISK',
        'NEW',
      ]);

      // segmentCounts uses its own CASE: it must agree too
      const counts = await repo.segmentCounts(t.db, vendorId, now, THRESHOLDS);
      const expectedCounts = new Map<string, number>();
      for (const row of rows) {
        const s = classifyCustomer(row, now, THRESHOLDS);
        expectedCounts.set(s, (expectedCounts.get(s) ?? 0) + 1);
      }
      for (const c of counts) expect(c.customers).toBe(expectedCounts.get(c.segment) ?? 0);

      // and the segment filter selects exactly the classified rows
      const atRiskRows = await repo.customers(
        t.db,
        vendorId,
        { segments: ['AT_RISK'] },
        { sort: 'last_order', after: null, limit: 100 },
        now,
        THRESHOLDS,
      );
      expect(atRiskRows.map((r) => r.customerId).sort()).toEqual(
        rows
          .filter((r) => classifyCustomer(r, now, THRESHOLDS) === 'AT_RISK')
          .map((r) => r.customerId)
          .sort(),
      );

      // the lean audience queries (ids / counts) carry their own CASE: same answer per segment.
      // Everyone but fixture 0 opted in, so eligible = matched minus that customer.
      for (const id of ids.slice(1)) await optIn(t.db, id, vendorId);
      const noFilter = { segments: [], tags: [], boughtProductIds: [], lastOrderWithinDays: null };
      for (const segment of CustomerSegmentSchema.options) {
        const expected = rows
          .filter((r) => classifyCustomer(r, now, THRESHOLDS) === segment)
          .map((r) => r.customerId)
          .sort();
        const eligible = expected.filter((id) => id !== ids[0]);
        const audience = { ...noFilter, segments: [segment] };
        expect({
          segment,
          ids: await repo.audienceIds(t.db, vendorId, audience, now, THRESHOLDS, null),
        }).toEqual({ segment, ids: eligible });
        expect({
          segment,
          counts: await repo.audienceCounts(t.db, vendorId, audience, now),
        }).toEqual({
          segment,
          counts: { matched: expected.length, eligible: eligible.length },
        });
      }
      const all = await repo.resolveAudience(t.db, vendorId, noFilter, now);
      expect(all.map((r) => r.userId).sort()).toEqual(ids.slice(1).sort());
      expect(await repo.hasEligibleAudience(t.db, vendorId, noFilter, now)).toBe(true);
    });

    it('groups spend by currency and takes the province from the latest valid order', async () => {
      const c = await customer();
      await makeSubOrder(t.db, {
        customerId: c.id,
        vendorId,
        variantId,
        at: ago(9),
        currency: 'USD',
        subtotal: 1_000,
        shipping: 500,
        city: 'Đà Nẵng',
      });
      await makeSubOrder(t.db, { customerId: c.id, vendorId, variantId, at: ago(8), city: 'Huế' });
      await makeSubOrder(t.db, {
        customerId: c.id,
        vendorId,
        variantId,
        status: 'REFUNDED',
        at: ago(1),
        city: 'Hà Nội',
      });
      const [item] = await listAll();
      expect(item?.spend).toEqual([
        // alphabetical by currency code
        { amount: 1_500, currency: 'USD' },
        { amount: 230_000, currency: 'VND' },
      ]);
      expect(item?.province).toBe('Huế');
    });

    it('never exposes email or phone', async () => {
      const c = await makeUser(t.db, { email: 'secret.person@example.com', name: 'Lan' });
      await makeSubOrder(t.db, { customerId: c.id, vendorId, variantId, at: ago(3) });
      await call(owner, 'POST', `/vendor/crm/customers/${c.id}/notes`, { body: 'VIP' });
      for (const url of ['/vendor/crm/customers', `/vendor/crm/customers/${c.id}`]) {
        const res = await call(owner, 'GET', url);
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toMatch(/"(email|phone)"/);
        expect(res.body).not.toContain('secret.person');
        expect(res.body).not.toContain('0901234567');
        expect(res.body).not.toContain('Lê Lợi');
      }
      const detail = CrmCustomerDetailSchema.parse(
        (await call(owner, 'GET', `/vendor/crm/customers/${c.id}`)).json(),
      );
      expect(detail.name).toBe('Lan');
      expect(detail.recentOrders).toHaveLength(1);
      expect(detail.notes.map((n) => n.body)).toEqual(['VIP']);
    });

    it("keeps vendors apart: another shop's customer is 404 and not listed", async () => {
      const c = await customer();
      await makeSubOrder(t.db, {
        customerId: c.id,
        vendorId: otherVendorId,
        variantId: otherVariantId,
        at: ago(2),
      });
      expect(await listAll()).toEqual([]);
      const res = await call(owner, 'GET', `/vendor/crm/customers/${c.id}`);
      expect(res.statusCode).toBe(404);
      expect(res.json<ErrorBody>().errorCode).toBe('crm.error.not-a-customer');
      expect((await call(otherOwner, 'GET', `/vendor/crm/customers/${c.id}`)).statusCode).toBe(200);
      const tags = await call(owner, 'PUT', `/vendor/crm/customers/${c.id}/tags`, { tags: ['x'] });
      expect(tags.statusCode).toBe(404);
    });

    it('detail lists reviews on this shop only', async () => {
      const c = await customer();
      const so = await makeSubOrder(t.db, { customerId: c.id, vendorId, variantId, at: ago(2) });
      const otherSo = await makeSubOrder(t.db, {
        customerId: c.id,
        vendorId: otherVendorId,
        variantId: otherVariantId,
        at: ago(2),
      });
      const otherProductId = (
        await t.db.productVariant.findUniqueOrThrow({ where: { id: otherVariantId } })
      ).productId;
      await t.db.review.createMany({
        data: [
          { id: ulid(), productId, authorId: c.id, subOrderId: so, rating: 5, body: 'Tốt' },
          { id: ulid(), productId: otherProductId, authorId: c.id, subOrderId: otherSo, rating: 1 },
        ],
      });
      const detail = CrmCustomerDetailSchema.parse(
        (await call(owner, 'GET', `/vendor/crm/customers/${c.id}`)).json(),
      );
      expect(detail.reviews.map((r) => [r.productId, r.rating])).toEqual([[productId, 5]]);
    });

    it('paginates with an opaque keyset cursor and rejects garbage cursors', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const c = await customer();
        ids.push(c.id);
        for (let k = 0; k <= i % 3; k += 1) {
          await makeSubOrder(t.db, { customerId: c.id, vendorId, variantId, at: ago(10 - i, k) });
        }
      }
      for (const sort of ['last_order', 'order_count'] as const) {
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const q: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
          const res = await call(owner, 'GET', `/vendor/crm/customers?limit=2&sort=${sort}${q}`);
          expect(res.statusCode).toBe(200);
          const page = CrmCustomerPageSchema.parse(res.json());
          seen.push(...page.items.map((i) => i.customerId));
          cursor = page.nextCursor;
        } while (cursor !== null);
        expect(new Set(seen).size).toBe(5);
        const all = await listAll(`&sort=${sort}`);
        expect(seen).toEqual(all.map((i) => i.customerId));
      }
      // last_order: newest first
      expect((await listAll()).map((i) => i.customerId)).toEqual([...ids].reverse());

      const first = CrmCustomerPageSchema.parse(
        (await call(owner, 'GET', '/vendor/crm/customers?limit=2')).json(),
      );
      const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const id = ids[0] ?? '';
      const bad: [string, string][] = [
        ['garbage!!', ''],
        [b64({ s: 'last_order', k: 'x', id: 'y' }), ''],
        [first.nextCursor ?? '', '&sort=order_count'],
        // beyond Postgres int4 / outside the timestamp range Postgres accepts
        [b64({ s: 'order_count', k: 2_147_483_648, id }), '&sort=order_count'],
        [b64({ s: 'last_order', k: '0000-01-01T00:00:00Z', id }), ''],
        [b64({ s: 'last_order', k: '1969-12-31T23:59:59Z', id }), ''],
      ];
      for (const [cursor, sort] of bad) {
        const res = await call(owner, 'GET', `/vendor/crm/customers?cursor=${cursor}${sort}`);
        expect({ cursor, status: res.statusCode }).toEqual({ cursor, status: 422 });
        expect(res.json<ErrorBody>()).toEqual({
          errorCode: 'common.error.validation-failed',
          params: { field: 'cursor' },
        });
      }
      // the bounds themselves are accepted
      const ok = await call(
        owner,
        'GET',
        `/vendor/crm/customers?sort=order_count&cursor=${b64({ s: 'order_count', k: 2_147_483_647, id })}`,
      );
      expect(ok.statusCode).toBe(200);
    });

    it('rejects NUL bytes in q and tag with 422 (not a 500)', async () => {
      for (const query of ['q=a%00b', 'tag=a%00b']) {
        const res = await call(owner, 'GET', `/vendor/crm/customers?${query}`);
        expect({ query, status: res.statusCode }).toEqual({ query, status: 422 });
        expect(res.json<ErrorBody>().errorCode).toBe('common.error.validation-failed');
      }
    });

    it('filters by segment, tag, bought product and name', async () => {
      const lan = await customer('Trần Thị Lan');
      await makeSubOrder(t.db, { customerId: lan.id, vendorId, variantId, at: ago(3) });
      const other = await makeProduct(t.db, { vendorId });
      const minh = await customer('Lê Minh_100%');
      await makeSubOrder(t.db, {
        customerId: minh.id,
        vendorId,
        variantId: other.variants[0]?.id ?? '',
        at: ago(100),
      });

      const put = await call(staff, 'PUT', `/vendor/crm/customers/${lan.id}/tags`, {
        tags: [' Sỉ ', 'vip'],
      });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual({ tags: ['sỉ', 'vip'] });

      const ids = async (q: string) => (await listAll(q)).map((i) => i.customerId);
      expect(await ids('&segment=AT_RISK')).toEqual([minh.id]);
      expect(await ids('&tag=vip')).toEqual([lan.id]);
      expect(await ids(`&productId=${productId}`)).toEqual([lan.id]);
      expect(await ids('&q=lan')).toEqual([lan.id]);
      expect(await ids(`&q=${encodeURIComponent('_100%')}`)).toEqual([minh.id]);
      expect(await ids(`&q=${encodeURIComponent('%')}`)).toEqual([minh.id]);
      expect(await ids(`&q=${minh.id}`)).toEqual([minh.id]);
    });

    it('notes: author or owner may delete (soft); others get 403', async () => {
      const c = await customer();
      await makeSubOrder(t.db, { customerId: c.id, vendorId, variantId, at: ago(3) });
      const created = await call(staff, 'POST', `/vendor/crm/customers/${c.id}/notes`, {
        body: '  Thích màu xanh  ',
      });
      expect(created.statusCode).toBe(201);
      const note = created.json<{ id: string; body: string; authorName: string }>();
      expect(note.body).toBe('Thích màu xanh');

      const staff2 = await makeUser(t.db, { roles: ['VENDOR_STAFF'], vendorId });
      const del = (h: Record<string, string>) =>
        call(h, 'DELETE', `/vendor/crm/customers/${c.id}/notes/${note.id}`);
      expect((await del(await t.authHeader(staff2))).statusCode).toBe(403);
      expect((await del(otherOwner)).statusCode).toBe(404);
      expect((await del(owner)).statusCode).toBe(204);
      const again = await del(staff);
      expect(again.statusCode).toBe(404);
      expect(again.json<ErrorBody>().errorCode).toBe('crm.error.note-not-found');
      const row = await t.db.vendorCustomerNote.findUniqueOrThrow({ where: { id: note.id } });
      expect(row.deletedAt).not.toBeNull();
      expect(row.authorId).toBe(staffId);

      const own = await call(staff, 'POST', `/vendor/crm/customers/${c.id}/notes`, { body: 'x' });
      expect((await del(staff)).statusCode).toBe(404); // the first one is gone
      const ownId = own.json<{ id: string }>().id;
      expect(
        (await call(staff, 'DELETE', `/vendor/crm/customers/${c.id}/notes/${ownId}`)).statusCode,
      ).toBe(204);

      const stranger = await customer();
      expect(
        (await call(owner, 'POST', `/vendor/crm/customers/${stranger.id}/notes`, { body: 'x' }))
          .statusCode,
      ).toBe(404);
    });

    it('refuses writes for a suspended vendor', async () => {
      const c = await customer();
      await makeSubOrder(t.db, { customerId: c.id, vendorId, variantId, at: ago(3) });
      await t.db.vendor.update({ where: { id: vendorId }, data: { status: 'SUSPENDED' } });
      const res = await call(owner, 'PUT', `/vendor/crm/customers/${c.id}/tags`, { tags: ['a'] });
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorBody>().errorCode).toBe('vendor.error.suspended');
    });
  });

  describe('automations', () => {
    const body = {
      isEnabled: true,
      delayDays: 30,
      templateVi: 'Chào {customerName}, {shopName} tặng mã {couponCode}.',
      templateEn: null,
      couponId: null as string | null,
    };

    it('lists the three kinds with defaults, owner saves, staff is 403', async () => {
      const list = await call(staff, 'GET', '/vendor/crm/automations');
      expect(list.statusCode).toBe(200);
      const items = CrmAutomationSchema.array().parse(list.json());
      expect(items.map((a) => [a.kind, a.messageKind, a.isEnabled, a.delayDays])).toEqual([
        ['THANK_YOU', 'SERVICE', false, 1],
        ['REVIEW_REQUEST', 'SERVICE', false, 3],
        ['REORDER_REMINDER', 'MARKETING', false, 30],
      ]);

      const coupon = await makeCoupon(t.db, { scope: 'VENDOR', vendorId, code: 'BACK10' });
      const put = { ...body, couponId: coupon.id };
      expect(
        (await call(staff, 'PUT', '/vendor/crm/automations/REORDER_REMINDER', put)).statusCode,
      ).toBe(403);
      const saved = await call(owner, 'PUT', '/vendor/crm/automations/REORDER_REMINDER', put);
      expect(saved.statusCode).toBe(200);
      expect(CrmAutomationSchema.parse(saved.json())).toMatchObject({
        kind: 'REORDER_REMINDER',
        isEnabled: true,
        couponId: coupon.id,
      });
      const after = CrmAutomationSchema.array().parse(
        (await call(owner, 'GET', '/vendor/crm/automations')).json(),
      );
      expect(after.find((a) => a.kind === 'REORDER_REMINDER')?.isEnabled).toBe(true);
    });

    it('concurrent first saves of the same kind both succeed with one row', async () => {
      const puts = await Promise.all(
        [1, 2, 3, 4].map((delayDays) =>
          call(owner, 'PUT', '/vendor/crm/automations/THANK_YOU', {
            ...body,
            delayDays,
            templateVi: 'Cảm ơn {customerName}',
          }),
        ),
      );
      expect(puts.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
      const rows = await t.db.crmAutomation.findMany({ where: { vendorId } });
      expect(rows).toHaveLength(1);
      expect([1, 2, 3, 4]).toContain(rows[0]?.delayDays);
    });

    it('validates delay, coupon, links and placeholders', async () => {
      const mine = await makeCoupon(t.db, { scope: 'VENDOR', vendorId, code: 'MINE1' });
      const foreign = await makeCoupon(t.db, {
        scope: 'VENDOR',
        vendorId: otherVendorId,
        code: 'THEIRS',
      });
      const expired = await makeCoupon(t.db, {
        scope: 'VENDOR',
        vendorId,
        code: 'OLD1',
        startsAt: ago(30),
        endsAt: ago(1),
      });
      const inactive = await makeCoupon(t.db, {
        scope: 'VENDOR',
        vendorId,
        code: 'OFF1',
        isActive: false,
      });
      const badCode = await makeCoupon(t.db, { scope: 'VENDOR', vendorId, code: 'shop.vn' });
      const platform = await makeCoupon(t.db, { code: 'PLAT1' });

      const cases: [string, object, string, Record<string, unknown>?][] = [
        [
          'THANK_YOU',
          { ...body, delayDays: 8, templateVi: 'Cảm ơn' },
          'common.error.validation-failed',
        ],
        [
          'REORDER_REMINDER',
          { ...body, delayDays: 6, couponId: mine.id },
          'common.error.validation-failed',
        ],
        [
          'THANK_YOU',
          { ...body, delayDays: 1, templateVi: 'Cảm ơn', couponId: mine.id },
          'common.error.validation-failed',
        ],
        ['REORDER_REMINDER', { ...body, couponId: foreign.id }, 'crm.error.coupon-invalid'],
        ['REORDER_REMINDER', { ...body, couponId: expired.id }, 'crm.error.coupon-invalid'],
        ['REORDER_REMINDER', { ...body, couponId: inactive.id }, 'crm.error.coupon-invalid'],
        ['REORDER_REMINDER', { ...body, couponId: badCode.id }, 'crm.error.coupon-invalid'],
        ['REORDER_REMINDER', { ...body, couponId: platform.id }, 'crm.error.coupon-invalid'],
        ['REORDER_REMINDER', body, 'crm.error.unknown-placeholder', { placeholder: 'couponCode' }],
        [
          'REORDER_REMINDER',
          { ...body, couponId: mine.id, templateEn: 'See www.evil.com' },
          'crm.error.links-not-allowed',
          { match: 'www.' },
        ],
        [
          'REORDER_REMINDER',
          { ...body, couponId: mine.id, templateVi: 'Gọi {phone}' },
          'crm.error.unknown-placeholder',
          { placeholder: 'phone' },
        ],
      ];
      for (const [kind, payload, code, params] of cases) {
        const res = await call(owner, 'PUT', `/vendor/crm/automations/${kind}`, payload);
        expect({ code: res.json<ErrorBody>().errorCode, status: res.statusCode }).toEqual({
          code,
          status: 422,
        });
        if (params) expect(res.json<ErrorBody>().params).toEqual(params);
      }
      expect(await t.db.crmAutomation.count()).toBe(0);
    });
  });

  describe('campaigns', () => {
    const draft = (overrides: object = {}) => ({
      name: 'Tri ân',
      audience: { segments: [], tags: [], boughtProductIds: [], lastOrderWithinDays: null },
      templateVi: 'Chào {customerName}, {shopName} gửi bạn mã {couponCode}',
      templateEn: null,
      couponId: null as string | null,
      ...overrides,
    });

    async function audience(optedIn: number, notOptedIn: number): Promise<void> {
      for (let i = 0; i < optedIn + notOptedIn; i += 1) {
        const c = await customer();
        await makeSubOrder(t.db, { customerId: c.id, vendorId, variantId, at: ago(5) });
        if (i < optedIn) await optIn(t.db, c.id, vendorId);
      }
    }

    async function create(h: Record<string, string>, payload: object): Promise<string> {
      const res = await call(h, 'POST', '/vendor/crm/campaigns', payload);
      expect(res.statusCode).toBe(201);
      return CrmCampaignSchema.parse(res.json()).id;
    }

    it('staff drafts + previews; preview counts only opted-in customers', async () => {
      await audience(2, 3);
      // an opted-out customer (opt-in older than opt-out) is not eligible
      const out = await customer();
      await makeSubOrder(t.db, { customerId: out.id, vendorId, variantId, at: ago(5) });
      await t.db.customerVendorPreference.create({
        data: {
          userId: out.id,
          vendorId,
          marketingOptInAt: ago(3),
          marketingOptOutAt: ago(2),
          unsubscribeTokenHash: ulid(),
        },
      });
      // other shop's opted-in customer is never counted
      const foreign = await customer();
      await makeSubOrder(t.db, {
        customerId: foreign.id,
        vendorId: otherVendorId,
        variantId: otherVariantId,
        at: ago(5),
      });
      await optIn(t.db, foreign.id, otherVendorId);

      const coupon = await makeCoupon(t.db, { scope: 'VENDOR', vendorId, code: 'TRIAN' });
      const id = await create(staff, draft({ couponId: coupon.id }));
      const res = await call(staff, 'POST', `/vendor/crm/campaigns/${id}/preview`);
      expect(res.statusCode).toBe(200);
      expect(CrmCampaignPreviewSchema.parse(res.json())).toEqual({
        matchedCustomers: 6,
        eligibleRecipients: 2,
        sample: {
          vi: 'Chào Minh, Shop A gửi bạn mã TRIAN',
          en: 'Chào Minh, Shop A gửi bạn mã TRIAN',
        },
      });
      expect(await t.db.crmMessage.count()).toBe(0);
    });

    it('rejects links, unknown placeholders and {couponCode} without a coupon', async () => {
      const cases: [object, string][] = [
        [draft({ templateVi: 'Mua tại shopa.vn/sale' }), 'crm.error.links-not-allowed'],
        [draft({ templateEn: 'Visit https://x.io' }), 'crm.error.links-not-allowed'],
        [draft({ templateVi: 'Chào {email}' }), 'crm.error.unknown-placeholder'],
        [draft(), 'crm.error.unknown-placeholder'],
      ];
      for (const [payload, code] of cases) {
        const res = await call(owner, 'POST', '/vendor/crm/campaigns', payload);
        expect({ status: res.statusCode, code: res.json<ErrorBody>().errorCode }).toEqual({
          status: 422,
          code,
        });
      }
      const foreign = await makeCoupon(t.db, { scope: 'VENDOR', vendorId: otherVendorId });
      const res = await call(
        owner,
        'POST',
        '/vendor/crm/campaigns',
        draft({ couponId: foreign.id }),
      );
      expect(res.json<ErrorBody>().errorCode).toBe('crm.error.coupon-invalid');
      expect(await t.db.crmCampaign.count()).toBe(0);
    });

    it('owner schedules: SCHEDULED + outbox in the same transaction; staff 403; not editable after', async () => {
      await audience(1, 0);
      const id = await create(staff, draft({ templateVi: 'Chào {customerName}' }));
      const sched = (h: Record<string, string>, scheduledAt: string | null = null) =>
        call(h, 'POST', `/vendor/crm/campaigns/${id}/schedule`, { scheduledAt });

      expect((await sched(staff)).statusCode).toBe(403);
      const inPast = await sched(owner, new Date(Date.now() - 60_000).toISOString());
      expect(inPast.statusCode).toBe(422);
      const tooFar = await sched(owner, new Date(Date.now() + 31 * DAY).toISOString());
      expect(tooFar.statusCode).toBe(422);

      const at = new Date(Date.now() + 2 * DAY);
      const res = await sched(owner, at.toISOString());
      expect(res.statusCode).toBe(200);
      const c = CrmCampaignSchema.parse(res.json());
      expect(c.status).toBe('SCHEDULED');
      expect(c.scheduledAt).toBe(at.toISOString());

      const events = await t.db.outboxEvent.findMany({
        where: { eventType: 'crm.campaign.scheduled' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        aggregateType: 'crm-campaign',
        aggregateId: id,
        payload: { campaignId: id, vendorId },
        nextAttemptAt: at,
      });

      const again = await sched(owner);
      expect(again.statusCode).toBe(409);
      expect(again.json<ErrorBody>().errorCode).toBe('crm.error.campaign-not-editable');
      const put = await call(
        owner,
        'PUT',
        `/vendor/crm/campaigns/${id}`,
        draft({ templateVi: 'Đổi' }),
      );
      expect(put.json<ErrorBody>().errorCode).toBe('crm.error.campaign-not-editable');
      expect((await call(otherOwner, 'GET', `/vendor/crm/campaigns/${id}`)).statusCode).toBe(404);
    });

    it('empty eligible audience → 422, nothing written', async () => {
      await audience(0, 2);
      const id = await create(owner, draft({ templateVi: 'Chào' }));
      const res = await call(owner, 'POST', `/vendor/crm/campaigns/${id}/schedule`, {
        scheduledAt: null,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json<ErrorBody>().errorCode).toBe('crm.error.empty-audience');
      expect((await t.db.crmCampaign.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
      expect(await t.db.outboxEvent.count()).toBe(0);
    });

    it('rejects a coupon no longer valid at the send time', async () => {
      await audience(1, 0);
      const coupon = await makeCoupon(t.db, {
        scope: 'VENDOR',
        vendorId,
        code: 'SHORT',
        endsAt: new Date(Date.now() + DAY),
      });
      const id = await create(owner, draft({ couponId: coupon.id }));
      const res = await call(owner, 'POST', `/vendor/crm/campaigns/${id}/schedule`, {
        scheduledAt: new Date(Date.now() + 3 * DAY).toISOString(),
      });
      expect(res.json<ErrorBody>().errorCode).toBe('crm.error.coupon-invalid');
    });

    it('enforces crmMaxCampaignsPerWeek over a sliding 7-day window → 429', async () => {
      await audience(1, 0);
      const ids = [];
      for (let i = 0; i < 4; i += 1) ids.push(await create(owner, draft({ templateVi: 'Hi' })));
      const schedule = (id: string, days: number) =>
        call(owner, 'POST', `/vendor/crm/campaigns/${id}/schedule`, {
          scheduledAt: new Date(Date.now() + days * DAY).toISOString(),
        });
      expect((await schedule(ids[0] ?? '', 1)).statusCode).toBe(200);
      expect((await schedule(ids[1] ?? '', 3)).statusCode).toBe(200);
      const third = await schedule(ids[2] ?? '', 6);
      expect(third.statusCode).toBe(429);
      expect(third.json<ErrorBody>()).toEqual({
        errorCode: 'crm.error.campaign-limit-reached',
        params: { limit: 2 },
      });
      // 8.5 days: the window [3, 10) holds days 3 and 8.5 only
      expect((await schedule(ids[3] ?? '', 8.5)).statusCode).toBe(200);
      // a cancelled campaign frees its slot
      expect(
        (await call(owner, 'POST', `/vendor/crm/campaigns/${ids[1] ?? ''}/cancel`)).statusCode,
      ).toBe(200);
      expect((await schedule(ids[2] ?? '', 6)).statusCode).toBe(200);
    });

    it('cancel: owner only, SCHEDULED messages SKIPPED, terminal after', async () => {
      await audience(1, 0);
      const id = await create(owner, draft({ templateVi: 'Hi' }));
      await call(owner, 'POST', `/vendor/crm/campaigns/${id}/schedule`, { scheduledAt: null });
      const recipient = await customer();
      const sent = await customer();
      await t.db.crmMessage.createMany({
        data: [
          {
            id: ulid(),
            vendorId,
            userId: recipient.id,
            kind: 'MARKETING',
            campaignId: id,
            channels: ['IN_APP'],
            scheduledFor: new Date(),
          },
          {
            id: ulid(),
            vendorId,
            userId: sent.id,
            kind: 'MARKETING',
            campaignId: id,
            channels: ['IN_APP'],
            status: 'SENT',
            sentAt: new Date(),
            scheduledFor: new Date(),
          },
        ],
      });

      expect((await call(staff, 'POST', `/vendor/crm/campaigns/${id}/cancel`)).statusCode).toBe(
        403,
      );
      const res = await call(owner, 'POST', `/vendor/crm/campaigns/${id}/cancel`);
      expect(res.statusCode).toBe(200);
      const c = CrmCampaignSchema.parse(res.json());
      expect(c.status).toBe('CANCELLED');
      expect(c.stats).toEqual({ sent: 1, skipped: 1, failed: 0, couponRedemptions: 0 });
      const msgs = await t.db.crmMessage.findMany({ where: { campaignId: id } });
      expect(msgs.map((m) => [m.status, m.skipReason]).sort()).toEqual([
        ['SENT', null],
        ['SKIPPED', 'CAMPAIGN_CANCELLED'],
      ]);
      const again = await call(owner, 'POST', `/vendor/crm/campaigns/${id}/cancel`);
      expect(again.statusCode).toBe(409);
    });

    it('platform staff list (filters) and cancel with a reason; vendors cannot', async () => {
      await audience(1, 0);
      const mine = await create(owner, draft({ templateVi: 'Hi' }));
      const other = await create(otherOwner, draft({ templateVi: 'Hi' }));
      const platformStaff = await t.authHeader(await makeUser(t.db, { roles: ['PLATFORM_STAFF'] }));

      const all = CrmCampaignPageSchema.parse(
        (await call(platformStaff, 'GET', '/platform/crm/campaigns')).json(),
      );
      expect(all.items.map((c) => c.id)).toEqual([other, mine]);
      const filtered = CrmCampaignPageSchema.parse(
        (
          await call(
            platformStaff,
            'GET',
            `/platform/crm/campaigns?vendorId=${vendorId}&status=DRAFT`,
          )
        ).json(),
      );
      expect(filtered.items.map((c) => c.id)).toEqual([mine]);

      expect((await call(owner, 'GET', '/platform/crm/campaigns')).statusCode).toBe(403);
      const tooShort = await call(platformStaff, 'POST', `/platform/crm/campaigns/${mine}/cancel`, {
        reason: 'x',
      });
      expect(tooShort.statusCode).toBe(422);
      const res = await call(platformStaff, 'POST', `/platform/crm/campaigns/${mine}/cancel`, {
        reason: 'Spam reports',
      });
      expect(res.statusCode).toBe(200);
      expect(CrmCampaignSchema.parse(res.json()).status).toBe('CANCELLED');
      const row = await t.db.crmCampaign.findUniqueOrThrow({ where: { id: mine } });
      expect(row.cancelReason).toBe('Spam reports');
      const unknown = await call(
        platformStaff,
        'POST',
        `/platform/crm/campaigns/${ulid()}/cancel`,
        {
          reason: 'Spam reports',
        },
      );
      expect(unknown.json<ErrorBody>().errorCode).toBe('crm.error.campaign-not-found');
    });

    it('a suspended vendor cannot schedule or cancel', async () => {
      await audience(1, 0);
      const draftId = await create(owner, draft({ templateVi: 'Hi' }));
      const scheduledId = await create(owner, draft({ templateVi: 'Hi' }));
      expect(
        (
          await call(owner, 'POST', `/vendor/crm/campaigns/${scheduledId}/schedule`, {
            scheduledAt: null,
          })
        ).statusCode,
      ).toBe(200);
      await t.db.vendor.update({ where: { id: vendorId }, data: { status: 'SUSPENDED' } });
      const attempts = [
        await call(owner, 'POST', `/vendor/crm/campaigns/${draftId}/schedule`, {
          scheduledAt: null,
        }),
        await call(owner, 'POST', `/vendor/crm/campaigns/${scheduledId}/cancel`),
      ];
      for (const res of attempts) {
        expect(res.statusCode).toBe(403);
        expect(res.json<ErrorBody>().errorCode).toBe('vendor.error.suspended');
      }
      const rows = await t.db.crmCampaign.findMany({ orderBy: { id: 'asc' } });
      expect(rows.map((r) => r.status)).toEqual(['DRAFT', 'SCHEDULED']);
    });

    it('concurrent schedule + update never schedules unvalidated content', async () => {
      await audience(1, 0);
      // Valid now but expired before the send time: an update may save it on a DRAFT, a schedule
      // must reject it. Whatever the interleaving, a SCHEDULED campaign never carries it.
      const shortCoupon = await makeCoupon(t.db, {
        scope: 'VENDOR',
        vendorId,
        code: 'SHORTLIVED',
        endsAt: new Date(Date.now() + DAY),
      });
      const sendAt = new Date(Date.now() + 3 * DAY).toISOString();
      for (let round = 0; round < 6; round += 1) {
        const id = await create(owner, draft({ templateVi: 'Hi' }));
        const [sched, put] = await Promise.all([
          call(owner, 'POST', `/vendor/crm/campaigns/${id}/schedule`, { scheduledAt: sendAt }),
          call(owner, 'PUT', `/vendor/crm/campaigns/${id}`, draft({ couponId: shortCoupon.id })),
        ]);
        const row = await t.db.crmCampaign.findUniqueOrThrow({ where: { id } });
        if (row.status === 'SCHEDULED') {
          // schedule won: the update waited on the row lock and then hit the DRAFT check
          expect({ round, sched: sched.statusCode, put: put.statusCode }).toEqual({
            round,
            sched: 200,
            put: 409,
          });
          expect(row.couponId).toBeNull();
          // free the weekly slot for the next round
          await t.db.crmCampaign.update({ where: { id }, data: { status: 'CANCELLED' } });
        } else {
          // update won: the schedule validated the updated content and rejected the coupon
          expect({ round, sched: sched.statusCode, put: put.statusCode }).toEqual({
            round,
            sched: 422,
            put: 200,
          });
          expect(sched.json<ErrorBody>().errorCode).toBe('crm.error.coupon-invalid');
          expect(row.couponId).toBe(shortCoupon.id);
        }
      }
    });

    it('owner is checked per vendor in the DB, not from the JWT roles', async () => {
      // owns vendor B, staff on vendor A, acting for A
      const dual = await makeUser(t.db, { roles: ['VENDOR_STAFF'], vendorId });
      await makeVendor(t.db, { ownerId: dual.id });
      const token = await t.signAccessToken(dual, ['VENDOR_OWNER', 'VENDOR_STAFF'], vendorId);
      const h = { authorization: `Bearer ${token}` };
      const id = await create(owner, draft({ templateVi: 'Hi' }));
      expect((await call(h, 'POST', `/vendor/crm/campaigns/${id}/cancel`)).statusCode).toBe(403);
      // staff-level reads still work for the same caller
      expect((await call(h, 'GET', `/vendor/crm/campaigns/${id}`)).statusCode).toBe(200);
    });
  });

  it('weekly-limit window helper', () => {
    expect(exceedsWeeklyLimit([0, DAY, 2 * DAY], 2)).toBe(true);
    expect(exceedsWeeklyLimit([0, 3 * DAY, 7 * DAY], 2)).toBe(false);
    // exactly 7 days apart never share a window [s, s + 7d); 1 ms less does
    expect(exceedsWeeklyLimit([0, DAY, 7 * DAY], 2)).toBe(false);
    expect(exceedsWeeklyLimit([0, DAY, 7 * DAY - 1], 2)).toBe(true);
    expect(exceedsWeeklyLimit([0], 1)).toBe(false);
  });

  describe('platform settings CRM thresholds', () => {
    it('reads and updates the crm* fields; at-risk must stay below lapsed (merged)', async () => {
      const admin = await t.authHeader(await makeUser(t.db, { roles: ['PLATFORM_ADMIN'] }));
      const get = await call(admin, 'GET', '/platform/settings');
      expect(get.statusCode).toBe(200);
      expect(get.json()).toMatchObject({
        crmAtRiskAfterDays: 60,
        crmLapsedAfterDays: 180,
        crmVipMinOrders: 3,
        crmMaxCampaignsPerWeek: 2,
        crmMaxMarketingPerCustomerPerWeek: 2,
      });
      const ok = await call(admin, 'PATCH', '/platform/settings', {
        crmVipMinOrders: 5,
        crmMaxCampaignsPerWeek: 3,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ crmVipMinOrders: 5, crmMaxCampaignsPerWeek: 3 });
      const bad = await call(admin, 'PATCH', '/platform/settings', { crmAtRiskAfterDays: 200 });
      expect(bad.statusCode).toBe(422);
      expect(bad.json<ErrorBody>().params).toMatchObject({ field: 'crmAtRiskAfterDays' });
    });
  });
});
