import { Role } from '@repo/core';
import { ulid } from 'ulid';
import {
  type TestApp,
  createTestApp,
  makePlatformSettings,
  makeUser,
  makeVendor,
} from '../support';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  const settings = await makePlatformSettings(t.db);
  await t.db.platformSettings.update({
    where: { id: settings.id },
    data: { defaultCurrency: 'USD' },
  });
});

type User = Parameters<TestApp['authHeader']>[0];

async function call(user: User, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const headers: Record<string, string> = { ...(await t.authHeader(user)) };
  if (method === 'POST') headers['idempotency-key'] = ulid();
  const res = await t.app.inject({ method, url: `/v1${url}`, headers, payload: payload as object });
  return { status: res.statusCode, json: (res.body ? JSON.parse(res.body) : null) as unknown };
}

const kycKey = (userId: string) => `kyc/${userId}/${ulid()}.jpg`;
const application = (userId: string) => ({
  businessLicenseKey: kycKey(userId),
  taxId: '0312345678',
  nationalIdNumber: '079123456789',
  nationalIdKey: kycKey(userId),
  bankName: 'Vietcombank',
  bankAccountNumber: '0071001234567',
  accountHolder: 'NGUYEN VAN A',
});

interface Row {
  id: string;
  status: string;
  vendorId?: string | null;
  taxIdMasked?: string;
  bankAccountNumberMasked?: string;
  nationalIdNumberMasked?: string;
  taxId?: string;
  businessLicenseUrl?: string;
}
const asRow = (json: unknown) => json as Row;

const staff = () => makeUser(t.db, { roles: [Role.PLATFORM_STAFF] });

async function submit(user: User & { id: string }) {
  const res = await call(user, 'POST', '/vendor-applications', application(user.id));
  expect(res.status).toBe(201);
  return asRow(res.json);
}

describe('submit', () => {
  it('creates a PENDING application and shows it under /me', async () => {
    const user = await makeUser(t.db);
    const created = await submit(user);
    expect(created.status).toBe('PENDING');
    const me = await call(user, 'GET', '/vendor-applications/me');
    const body = me.json as { latest: Row; history: Row[] };
    expect(body.latest.id).toBe(created.id);
    expect(body.history).toHaveLength(1);
  });

  it('rejects a second submit while one is PENDING', async () => {
    const user = await makeUser(t.db);
    await submit(user);
    const res = await call(user, 'POST', '/vendor-applications', application(user.id));
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ errorCode: 'vendor.error.application-already-pending' });
  });

  it('rejects KYC keys that belong to someone else', async () => {
    const user = await makeUser(t.db);
    const other = await makeUser(t.db);
    const res = await call(user, 'POST', '/vendor-applications', {
      ...application(user.id),
      nationalIdKey: kycKey(other.id),
    });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ errorCode: 'upload.error.invalid-key' });
  });

  it('answers 409 conflict for a CUSTOMER who owns a vendor', async () => {
    const owner = await makeUser(t.db);
    await makeVendor(t.db, { ownerId: owner.id });
    const res = await call(owner, 'POST', '/vendor-applications', application(owner.id));
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ errorCode: 'common.error.conflict' });
  });
});

describe('platform review', () => {
  it('forbids customers on every platform endpoint', async () => {
    const user = await makeUser(t.db);
    const app = await submit(user);
    expect((await call(user, 'GET', '/platform/vendor-applications')).status).toBe(403);
    expect((await call(user, 'GET', `/platform/vendor-applications/${app.id}`)).status).toBe(403);
    const approve = await call(user, 'POST', `/platform/vendor-applications/${app.id}/approve`, {
      slug: 'x',
      displayName: 'X',
    });
    expect(approve.status).toBe(403);
    const reject = await call(user, 'POST', `/platform/vendor-applications/${app.id}/reject`, {
      reason: 'no',
    });
    expect(reject.status).toBe(403);
  });

  it('masks KYC numbers in the list and filters by status', async () => {
    const user = await makeUser(t.db);
    await submit(user);
    const reviewer = await staff();
    const list = await call(reviewer, 'GET', '/platform/vendor-applications?status=PENDING');
    const page = list.json as { items: Row[]; nextCursor: string | null };
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      taxIdMasked: '******5678',
      nationalIdNumberMasked: '********6789',
      bankAccountNumberMasked: '*********4567',
    });
    expect(JSON.stringify(page)).not.toContain('0312345678');
    const none = await call(reviewer, 'GET', '/platform/vendor-applications?status=APPROVED');
    expect((none.json as { items: Row[] }).items).toHaveLength(0);
  });

  it('returns full data and presigned document URLs in the detail', async () => {
    const user = await makeUser(t.db);
    const created = await submit(user);
    const res = await call(await staff(), 'GET', `/platform/vendor-applications/${created.id}`);
    expect(res.status).toBe(200);
    const detail = asRow(res.json);
    expect(detail.taxId).toBe('0312345678');
    expect(detail.businessLicenseUrl).toContain(`kyc/${user.id}/`);
    expect(detail.businessLicenseUrl).toContain('X-Amz-Signature');
  });

  it('approves: vendor + wallet + role, and the next token carries VENDOR_OWNER + vendorId', async () => {
    const user = await makeUser(t.db);
    const created = await submit(user);
    const res = await call(
      await staff(),
      'POST',
      `/platform/vendor-applications/${created.id}/approve`,
      { slug: 'my-shop', displayName: 'My Shop' },
    );
    expect(res.status).toBe(200);
    const vendorId = asRow(res.json).vendorId;
    expect(asRow(res.json).status).toBe('APPROVED');

    const vendor = await t.db.vendor.findUniqueOrThrow({
      where: { slug: 'my-shop' },
      include: { wallet: true },
    });
    expect(vendor.id).toBe(vendorId);
    expect(vendor.status).toBe('ACTIVE');
    expect(vendor.ownerId).toBe(user.id);
    expect(vendor.wallet).toMatchObject({ balanceAmount: 0n, balanceCurrency: 'USD' });
    const events = await t.db.outboxEvent.findMany({
      where: { eventType: 'vendor.application.approved' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      applicationId: created.id,
      vendorId,
      userId: user.id,
    });

    const me = await call(user, 'GET', '/auth/me');
    expect(me.json).toMatchObject({ roles: expect.arrayContaining(['CUSTOMER', 'VENDOR_OWNER']) });
    expect(me.json).toMatchObject({ vendorId });
  });

  it('approving twice, or concurrently, creates exactly one vendor', async () => {
    const user = await makeUser(t.db);
    const created = await submit(user);
    const reviewer = await staff();
    const url = `/platform/vendor-applications/${created.id}/approve`;
    const results = await Promise.all([
      call(reviewer, 'POST', url, { slug: 'shop-a', displayName: 'A' }),
      call(reviewer, 'POST', url, { slug: 'shop-b', displayName: 'B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await t.db.vendor.count()).toBe(1);
    const again = await call(reviewer, 'POST', url, { slug: 'shop-c', displayName: 'C' });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ errorCode: 'vendor.error.application-not-pending' });
  });

  it('refuses a slug already taken and leaves the application PENDING', async () => {
    const { vendor } = await makeVendor(t.db);
    const user = await makeUser(t.db);
    const created = await submit(user);
    const res = await call(
      await staff(),
      'POST',
      `/platform/vendor-applications/${created.id}/approve`,
      { slug: vendor.slug, displayName: 'Dup' },
    );
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ errorCode: 'common.error.conflict' });
    const row = await t.db.vendorApplication.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('PENDING');
  });

  it('forbids staff from reviewing their own application', async () => {
    const reviewer = await makeUser(t.db, { roles: [Role.CUSTOMER, Role.PLATFORM_ADMIN] });
    const created = await submit(reviewer);
    const res = await call(
      reviewer,
      'POST',
      `/platform/vendor-applications/${created.id}/approve`,
      { slug: 'self-shop', displayName: 'Self' },
    );
    expect(res.status).toBe(403);
    expect(await t.db.vendor.count()).toBe(0);
  });

  it('does not return KYC numbers when submitting (response is cached by idempotency)', async () => {
    const user = await makeUser(t.db);
    const res = await call(user, 'POST', '/vendor-applications', application(user.id));
    expect(JSON.stringify(res.json)).not.toContain('0312345678');
    expect(JSON.stringify(res.json)).not.toContain('0071001234567');
  });

  it('validates the slug', async () => {
    const user = await makeUser(t.db);
    const created = await submit(user);
    const res = await call(
      await staff(),
      'POST',
      `/platform/vendor-applications/${created.id}/approve`,
      { slug: 'Bad Slug', displayName: 'X' },
    );
    expect(res.status).toBe(422);
  });

  it('rejects, writes the outbox event, and allows re-applying', async () => {
    const user = await makeUser(t.db);
    const created = await submit(user);
    const reviewer = await staff();
    const res = await call(reviewer, 'POST', `/platform/vendor-applications/${created.id}/reject`, {
      reason: 'Blurry documents',
    });
    expect(res.status).toBe(200);
    expect(asRow(res.json)).toMatchObject({ status: 'REJECTED', vendorId: null });
    expect(
      await t.db.outboxEvent.count({ where: { eventType: 'vendor.application.rejected' } }),
    ).toBe(1);
    const row = await t.db.vendorApplication.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ rejectReason: 'Blurry documents', reviewedById: reviewer.id });

    const second = await submit(user);
    expect(second.id).not.toBe(created.id);
    const me = (await call(user, 'GET', '/vendor-applications/me')).json as {
      latest: Row;
      history: Row[];
    };
    expect(me.latest.id).toBe(second.id);
    expect(me.history.map((r) => r.status)).toEqual(['PENDING', 'REJECTED']);

    const again = await call(
      reviewer,
      'POST',
      `/platform/vendor-applications/${created.id}/reject`,
      { reason: 'again' },
    );
    expect(again.status).toBe(409);
  });
});
