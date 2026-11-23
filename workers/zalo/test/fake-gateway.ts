import type { ZaloCredentials } from '../src/credentials.js';
import {
  QrLoginEndedError,
  ZaloRejectedError,
  type QrLoginEvent,
  type QrLoginEndReason,
  type ZaloGateway,
  type ZaloSession,
} from '../src/gateway.js';

export function fakeCredentials(tag = 'a'): ZaloCredentials {
  return {
    imei: `imei-${tag}`,
    userAgent: 'test-agent',
    language: 'vi',
    cookie: [{ key: 'zpw_sek', value: `cookie-${tag}`, domain: 'chat.zalo.me' }],
  };
}

export class FakeSession implements ZaloSession {
  readonly sent: { uid: string; text: string }[] = [];
  readonly lookups: string[] = [];
  /** phone → uid; missing = not on Zalo. */
  phones = new Map<string, string>();
  sendError: Error | undefined;
  /** Never settles — exercises the call timeout. */
  hangSend = false;
  keepAliveError: Error | undefined;
  closed = false;
  private creds: ZaloCredentials;

  constructor(
    readonly uid: string,
    credentials: ZaloCredentials,
    readonly displayName = `Zalo ${uid}`,
    readonly avatarUrl: string | null = null,
  ) {
    this.creds = credentials;
  }

  findUserByPhone(phone: string): Promise<string | null> {
    this.lookups.push(phone);
    return Promise.resolve(this.phones.get(phone) ?? null);
  }

  sendText(uid: string, text: string): Promise<{ messageId: string }> {
    if (this.hangSend) return new Promise(() => undefined);
    if (this.sendError) return Promise.reject(this.sendError);
    this.sent.push({ uid, text });
    return Promise.resolve({ messageId: String(1000 + this.sent.length) });
  }

  keepAlive(): Promise<void> {
    return this.keepAliveError ? Promise.reject(this.keepAliveError) : Promise.resolve();
  }

  rotateCookie(value: string): void {
    this.creds = { ...this.creds, cookie: [{ key: 'zpw_sek', value, domain: 'chat.zalo.me' }] };
  }

  credentials(): ZaloCredentials {
    return this.creds;
  }

  close(): void {
    this.closed = true;
  }
}

type QrScript =
  | { outcome: 'success'; session: FakeSession }
  | { outcome: 'end'; reason: QrLoginEndReason }
  | { outcome: 'error'; error: Error };

export class FakeGateway implements ZaloGateway {
  /** imei → session returned by login(credentials); missing → login rejects. */
  readonly sessions = new Map<string, FakeSession>();
  readonly logins: ZaloCredentials[] = [];
  loginError: Error | undefined;
  qr: QrScript = { outcome: 'end', reason: 'expired' };

  login(credentials: ZaloCredentials): Promise<ZaloSession> {
    this.logins.push(credentials);
    const session = this.sessions.get(credentials.imei);
    if (this.loginError || session === undefined) {
      return Promise.reject(this.loginError ?? new ZaloRejectedError('session rejected by Zalo'));
    }
    return Promise.resolve(session);
  }

  async loginWithQr(
    onEvent: (event: QrLoginEvent) => void,
    signal: AbortSignal,
  ): Promise<ZaloSession> {
    onEvent({ type: 'qr', image: 'iVBORw0KGgo=' });
    await Promise.resolve();
    if (signal.aborted) throw new QrLoginEndedError('aborted');
    const script = this.qr;
    if (script.outcome === 'end') throw new QrLoginEndedError(script.reason);
    if (script.outcome === 'error') throw script.error;
    onEvent({ type: 'scanned', displayName: script.session.displayName, avatarUrl: null });
    return script.session;
  }
}
