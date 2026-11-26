import { ulid } from 'ulid';
import { type TestApp, createTestApp, makeAddress, makeUser, makeVendor } from '../support';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const body = {
  recipientName: 'Trần Thị B',
  phone: '+84 912 345 678',
  line1: '12 Nguyễn Huệ',
  ward: 'Bến Nghé',
  district: 'Quận 1',
  city: 'Hồ Chí Minh',
};

async function call(
  user: Parameters<TestApp['authHeader']>[0],
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  const headers: Record<string, string> = { ...(await t.authHeader(user)) };
  if (method === 'POST' || method === 'PATCH') headers['idempotency-key'] = ulid();
  const res = await t.app.inject({ method, url: `/v1${url}`, headers, payload: payload as object });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as unknown) : null };
}

interface Addr {
  id: string;
  isDefault: boolean;
  city: string;
  country: string;
  line2: string | null;
}

async function listAddresses(user: Parameters<TestApp['authHeader']>[0]): Promise<Addr[]> {
  const res = await call(user, 'GET', '/me/addresses');
  expect(res.status).toBe(200);
  return res.json as Addr[];
}

describe('PATCH /v1/me', () => {
  it('updates name and primaryLocale and returns the MeResponse', async () => {
    const user = await makeUser(t.db);
    const res = await call(user, 'PATCH', '/me', { name: ' Lê Văn C ', primaryLocale: 'EN' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: user.id, name: 'Lê Văn C', primaryLocale: 'EN' });
  });

  it('rejects an empty body and ignores non-editable fields (422)', async () => {
    const user = await makeUser(t.db);
    expect((await call(user, 'PATCH', '/me', {})).status).toBe(422);
    const res = await call(user, 'PATCH', '/me', { name: 'X', email: 'evil@x.com' });
    expect(res.json).toMatchObject({ name: 'X', email: user.email });
  });

  it('requires the CUSTOMER role', async () => {
    const user = await makeUser(t.db);
    const token = await t.signAccessToken(user, ['PLATFORM_STAFF']);
    const res = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': ulid() },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('addresses CRUD', () => {
  it('first address becomes default; country defaults to VN; second is not default', async () => {
    const user = await makeUser(t.db);
    const a = await call(user, 'POST', '/me/addresses', body);
    expect(a.status).toBe(201);
    expect(a.json).toMatchObject({ isDefault: true, country: 'VN', line2: null });
    const b = await call(user, 'POST', '/me/addresses', body);
    expect(b.json).toMatchObject({ isDefault: false });
    const list = await listAddresses(user);
    expect(list).toHaveLength(2);
    expect(list[0]?.isDefault).toBe(true);
  });

  it('creating with isDefault moves the default', async () => {
    const user = await makeUser(t.db);
    await call(user, 'POST', '/me/addresses', body);
    const b = (await call(user, 'POST', '/me/addresses', { ...body, isDefault: true }))
      .json as Addr;
    const list = await listAddresses(user);
    expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([b.id]);
  });

  it('PATCH updates only the sent fields and can clear line2', async () => {
    const user = await makeUser(t.db);
    const a = (await call(user, 'POST', '/me/addresses', { ...body, line2: 'Tầng 3' }))
      .json as Addr;
    const up = await call(user, 'PATCH', `/me/addresses/${a.id}`, { city: 'Hà Nội' });
    expect(up.json).toMatchObject({ city: 'Hà Nội', line2: 'Tầng 3', country: 'VN' });
    const cleared = await call(user, 'PATCH', `/me/addresses/${a.id}`, { line2: null });
    expect(cleared.json).toMatchObject({ line2: null });
    expect((await call(user, 'PATCH', `/me/addresses/${a.id}`, {})).status).toBe(422);
  });

  it('rejects invalid input (422)', async () => {
    const user = await makeUser(t.db);
    expect((await call(user, 'POST', '/me/addresses', { ...body, phone: 'abc' })).status).toBe(422);
  });

  it('delete: non-default keeps default; deleting the default promotes the newest', async () => {
    const user = await makeUser(t.db);
    const a = (await call(user, 'POST', '/me/addresses', body)).json as Addr;
    const b = (await call(user, 'POST', '/me/addresses', body)).json as Addr;
    const c = (await call(user, 'POST', '/me/addresses', body)).json as Addr;
    expect((await call(user, 'DELETE', `/me/addresses/${b.id}`)).status).toBe(204);
    expect((await listAddresses(user)).find((x) => x.isDefault)?.id).toBe(a.id);
    expect((await call(user, 'DELETE', `/me/addresses/${a.id}`)).status).toBe(204);
    const list = await listAddresses(user);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: c.id, isDefault: true });
    expect((await call(user, 'DELETE', `/me/addresses/${c.id}`)).status).toBe(204);
    expect(await listAddresses(user)).toEqual([]);
  });

  it("another user's address is 404 for read-modify paths and untouched", async () => {
    const owner = await makeUser(t.db);
    const other = await makeUser(t.db);
    const addr = await makeAddress(t.db, { userId: owner.id, isDefault: true });
    const url = `/me/addresses/${addr.id}`;
    for (const res of [
      await call(other, 'PATCH', url, { city: 'X' }),
      await call(other, 'DELETE', url),
      await call(other, 'POST', `${url}/default`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.json).toMatchObject({ errorCode: 'address.error.not-found' });
    }
    expect(await listAddresses(other)).toEqual([]);
    expect(await listAddresses(owner)).toHaveLength(1);
    // Unknown (well-formed) id is 404 too; malformed id is 422.
    expect((await call(owner, 'DELETE', `/me/addresses/${ulid()}`)).status).toBe(404);
    expect((await call(owner, 'DELETE', '/me/addresses/nope')).status).toBe(422);
  });

  it('vendor-only users (no CUSTOMER role) are rejected', async () => {
    const { owner } = await makeVendor(t.db);
    const token = await t.signAccessToken(owner, ['VENDOR_OWNER']);
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/me/addresses',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('default-address invariant', () => {
  it('set-default switches the default', async () => {
    const user = await makeUser(t.db);
    const a = (await call(user, 'POST', '/me/addresses', body)).json as Addr;
    const b = (await call(user, 'POST', '/me/addresses', body)).json as Addr;
    const res = await call(user, 'POST', `/me/addresses/${b.id}/default`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: b.id, isDefault: true });
    const list = await listAddresses(user);
    expect(list.find((x) => x.id === a.id)?.isDefault).toBe(false);
    expect(list.filter((x) => x.isDefault)).toHaveLength(1);
  });

  it('concurrent set-default calls leave exactly one default', async () => {
    const user = await makeUser(t.db);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push(((await call(user, 'POST', '/me/addresses', body)).json as Addr).id);
    }
    for (let round = 0; round < 5; round += 1) {
      const results = await Promise.all(
        ids.map((id) => call(user, 'POST', `/me/addresses/${id}/default`)),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      const defaults = await t.db.address.count({ where: { userId: user.id, isDefault: true } });
      expect(defaults).toBe(1);
    }
  });

  it('concurrent first creates yield exactly one default', async () => {
    const user = await makeUser(t.db);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call(user, 'POST', '/me/addresses', body)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await t.db.address.count({ where: { userId: user.id, isDefault: true } })).toBe(1);
  });

  it('concurrent create(isDefault) + delete-default keeps exactly one default', async () => {
    const user = await makeUser(t.db);
    const first = (await call(user, 'POST', '/me/addresses', body)).json as Addr;
    await call(user, 'POST', '/me/addresses', body);
    await Promise.all([
      call(user, 'DELETE', `/me/addresses/${first.id}`),
      call(user, 'POST', '/me/addresses', { ...body, isDefault: true }),
    ]);
    expect(await t.db.address.count({ where: { userId: user.id, isDefault: true } })).toBe(1);
  });

  it('POST is idempotent: replay with the same key creates one address', async () => {
    const user = await makeUser(t.db);
    const headers = { ...(await t.authHeader(user)), 'idempotency-key': ulid() };
    const send = () =>
      t.app.inject({ method: 'POST', url: '/v1/me/addresses', headers, payload: body });
    const first = await send();
    const second = await send();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await t.db.address.count({ where: { userId: user.id } })).toBe(1);
  });
});
