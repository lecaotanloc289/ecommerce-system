import { ulid } from 'ulid';
import { type TestApp, createTestApp, makeUser } from '../support';

describe('in-app notifications', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  type User = Awaited<ReturnType<typeof makeUser>>;

  const call = async (user: User, method: 'GET' | 'POST', url: string) => {
    const res = await t.app.inject({
      method,
      url: `/v1/me/notifications${url}`,
      headers: await t.authHeader(user),
    });
    return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as unknown) : null };
  };

  const notify = (userId: string, title: string, readAt: Date | null = null) =>
    t.db.notification.create({
      data: { id: ulid(), userId, title, body: `${title} body`, readAt },
    });

  it('requires authentication', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/me/notifications' });
    expect(res.statusCode).toBe(401);
  });

  it('lists only own notifications, newest first, with cursor paging', async () => {
    const alice = await makeUser(t.db);
    const bob = await makeUser(t.db);
    await notify(alice.id, 'first');
    await notify(alice.id, 'second');
    await notify(alice.id, 'third');
    await notify(bob.id, 'bobs');

    const page1 = await call(alice, 'GET', '?limit=2');
    expect(page1.status).toBe(200);
    const body1 = page1.json as { items: { title: string }[]; nextCursor: string | null };
    expect(body1.items.map((n) => n.title)).toEqual(['third', 'second']);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await call(alice, 'GET', `?limit=2&cursor=${body1.nextCursor}`);
    const body2 = page2.json as { items: { title: string }[]; nextCursor: string | null };
    expect(body2.items.map((n) => n.title)).toEqual(['first']);
    expect(body2.nextCursor).toBeNull();
  });

  it('counts unread, marks one read idempotently, then read-all', async () => {
    const alice = await makeUser(t.db);
    const a = await notify(alice.id, 'a');
    await notify(alice.id, 'b');
    await notify(alice.id, 'old', new Date('2026-01-01T00:00:00Z'));

    expect((await call(alice, 'GET', '/unread-count')).json).toEqual({ count: 2 });

    const first = await call(alice, 'POST', `/${a.id}/read`);
    expect(first.status).toBe(200);
    const firstReadAt = (first.json as { readAt: string }).readAt;
    expect(firstReadAt).toEqual(expect.any(String));

    const again = await call(alice, 'POST', `/${a.id}/read`);
    expect(again.status).toBe(200);
    expect((again.json as { readAt: string }).readAt).toBe(firstReadAt);
    expect((await call(alice, 'GET', '/unread-count')).json).toEqual({ count: 1 });

    const all = await call(alice, 'POST', '/read-all');
    expect(all.status).toBe(204);
    expect((await call(alice, 'GET', '/unread-count')).json).toEqual({ count: 0 });
  });

  it("answers 404 notification.error.not-found for another user's or unknown notification", async () => {
    const alice = await makeUser(t.db);
    const bob = await makeUser(t.db);
    const bobs = await notify(bob.id, 'bobs');

    for (const id of [bobs.id, ulid()]) {
      const res = await call(alice, 'POST', `/${id}/read`);
      expect(res.status).toBe(404);
      expect(res.json).toEqual({ errorCode: 'notification.error.not-found', params: {} });
    }
    const untouched = await t.db.notification.findUniqueOrThrow({ where: { id: bobs.id } });
    expect(untouched.readAt).toBeNull();
  });

  it("read-all never touches another user's notifications", async () => {
    const alice = await makeUser(t.db);
    const bob = await makeUser(t.db);
    await notify(alice.id, 'a');
    await notify(bob.id, 'b');
    await call(alice, 'POST', '/read-all');
    expect((await call(bob, 'GET', '/unread-count')).json).toEqual({ count: 1 });
  });
});
