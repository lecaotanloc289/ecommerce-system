import { createHash } from 'node:crypto';
import { VendorInvitationCreatedEventSchema, VendorInvitationSchema } from '@repo/core';
import { ulid } from 'ulid';
import { type TestApp, createTestApp, makeUser, makeVendor } from '../support';

describe('vendor staff invitations (Testcontainers)', () => {
  let t: TestApp;
  let vendorId: string;
  let owner: { id: string };
  let ownerH: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    const a = await makeVendor(t.db);
    vendorId = a.vendor.id;
    owner = a.owner;
    ownerH = await t.authHeader(owner);
  });

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    auth: Record<string, string>,
    payload?: object,
  ) =>
    t.app.inject({
      method,
      url,
      headers: method === 'GET' ? auth : { ...auth, 'idempotency-key': ulid() },
      ...(payload && { payload }),
    });

  /** Invites `email`, returns invitation id + the raw token read from the outbox row. */
  async function invite(email: string, auth = ownerH) {
    const res = await call('POST', '/v1/vendor/invitations', auth, { email });
    if (res.statusCode !== 201) return { res, id: '', token: '' };
    const body = VendorInvitationSchema.parse(res.json());
    const event = await t.db.outboxEvent.findFirstOrThrow({
      where: { aggregateId: body.id, eventType: 'vendor.invitation.created' },
    });
    const payload = VendorInvitationCreatedEventSchema.parse(event.payload);
    return { res, id: body.id, token: payload.token };
  }

  const accept = (token: string, user: { id: string }) =>
    t.authHeader(user).then((h) => call('POST', '/v1/vendor-invitations/accept', h, { token }));

  it('invite -> outbox with token -> accept -> staff role + membership', async () => {
    const { res, id, token } = await invite('Staff@Example.com');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: 'staff@example.com', status: 'PENDING' });
    expect(JSON.stringify(res.json())).not.toContain(token);
    const row = await t.db.vendorInvitation.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    const staff = await makeUser(t.db, { email: 'staff@example.com' });
    const ok = await accept(token, staff);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ vendorId });

    const me = await call('GET', '/v1/auth/me', await t.authHeader(staff));
    expect(me.json()).toMatchObject({ vendorId });
    expect(me.json().roles).toContain('VENDOR_STAFF');

    const list = await call('GET', '/v1/vendor/invitations', ownerH);
    expect(list.json().items[0].status).toBe('ACCEPTED');
    const members = await call('GET', '/v1/vendor/staff', ownerH);
    expect(members.json()).toHaveLength(2);
  });

  it('rejects a mismatching email, a null-email user, and a token that does not exist', async () => {
    const { token } = await invite('staff@example.com');
    const other = await makeUser(t.db, { email: 'other@example.com' });
    const nullEmail = await makeUser(t.db, { email: null });
    expect((await accept(token, other)).json().errorCode).toBe('invitation.error.email-mismatch');
    expect((await accept(token, nullEmail)).json().errorCode).toBe(
      'invitation.error.email-mismatch',
    );
    expect((await accept('x'.repeat(43), other)).json().errorCode).toBe('invitation.error.invalid');
    expect(await t.db.userRole.count({ where: { role: 'VENDOR_STAFF' } })).toBe(0);
  });

  it('expired -> 410; revoked and reused tokens -> invalid', async () => {
    const staff = await makeUser(t.db, { email: 'staff@example.com' });

    const a = await invite('staff@example.com');
    await t.db.vendorInvitation.update({
      where: { id: a.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await accept(a.token, staff);
    expect(expired.statusCode).toBe(410);
    expect(expired.json().errorCode).toBe('invitation.error.expired');
    const listed = await call('GET', '/v1/vendor/invitations', ownerH);
    expect(listed.json().items[0].status).toBe('EXPIRED');

    // An expired invitation no longer blocks a new one.
    const b = await invite('staff@example.com');
    expect(b.res.statusCode).toBe(201);
    const revoke = await call('POST', `/v1/vendor/invitations/${b.id}/revoke`, ownerH);
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().status).toBe('REVOKED');
    expect((await accept(b.token, staff)).json().errorCode).toBe('invitation.error.invalid');

    const c = await invite('staff@example.com');
    expect((await accept(c.token, staff)).statusCode).toBe(200);
    expect((await accept(c.token, staff)).json().errorCode).toBe('invitation.error.invalid');
    const lateRevoke = await call('POST', `/v1/vendor/invitations/${c.id}/revoke`, ownerH);
    expect(lateRevoke.statusCode).toBe(409);
  });

  it('duplicate open invitation and existing member -> 409', async () => {
    expect((await invite('staff@example.com')).res.statusCode).toBe(201);
    const dup = await invite('STAFF@example.com');
    expect(dup.res.statusCode).toBe(409);
    expect(dup.res.json().errorCode).toBe('common.error.conflict');

    const ownerRow = await t.db.user.findUniqueOrThrow({ where: { id: owner.id } });
    const self = await invite(ownerRow.email ?? '');
    expect(self.res.statusCode).toBe(409);
  });

  it('staff cannot manage staff; removed staff lose access immediately; owner cannot be removed', async () => {
    const { token } = await invite('staff@example.com');
    const staff = await makeUser(t.db, { email: 'staff@example.com' });
    await accept(token, staff);
    const staffH = await t.authHeader(staff);

    expect(
      (await call('POST', '/v1/vendor/invitations', staffH, { email: 'a@b.co' })).statusCode,
    ).toBe(403);
    expect((await call('GET', '/v1/vendor/staff', staffH)).statusCode).toBe(403);
    // staff can use the catalog while a member
    expect((await call('GET', '/v1/vendor/shipping-methods', staffH)).statusCode).toBe(200);

    const ownerDel = await call('DELETE', `/v1/vendor/staff/${owner.id}`, ownerH);
    expect(ownerDel.statusCode).toBe(403);

    const del = await call('DELETE', `/v1/vendor/staff/${staff.id}`, ownerH);
    expect(del.statusCode).toBe(204);
    // same (still valid) access token is now refused by the membership guard
    expect((await call('GET', '/v1/vendor/shipping-methods', staffH)).statusCode).toBe(403);
    expect((await call('DELETE', `/v1/vendor/staff/${staff.id}`, ownerH)).statusCode).toBe(404);
  });

  it('refuses a user who already belongs to another vendor, and revoke is scoped to the vendor', async () => {
    const other = await makeVendor(t.db);
    const member = await makeUser(t.db, {
      email: 'staff@example.com',
      roles: ['CUSTOMER', 'VENDOR_STAFF'],
      vendorId: other.vendor.id,
    });
    const { id, token } = await invite('staff@example.com');
    const res = await accept(token, member);
    expect(res.statusCode).toBe(409);
    expect(res.json().errorCode).toBe('common.error.conflict');

    const foreign = await call(
      'POST',
      `/v1/vendor/invitations/${id}/revoke`,
      await t.authHeader(other.owner),
    );
    expect(foreign.statusCode).toBe(404);
  });
});
