import { LoginQRCallbackEventType, ThreadType, Zalo, ZaloApiError, type API } from 'zca-js';
import { ZaloCredentialsSchema, type ZaloCredentials } from './credentials.js';
import {
  QrLoginEndedError,
  ZaloRejectedError,
  type QrLoginEndReason,
  type QrLoginEvent,
  type ZaloGateway,
  type ZaloSession,
} from './gateway.js';

// zca-js adapter. zca-js drives the Zalo web client: `loginQR` emits the QR, waits for the scan and
// the confirmation on the phone, then logs in with the resulting cookies; `login(credentials)`
// restores a session from stored cookies. We never start `api.listener` (websocket): sending only.

const ZALO_OPTIONS = { selfListen: false, checkUpdate: false, logging: false } as const;

/** zca-js throws ZaloApiError when Zalo answers with an error; anything else is network-level. */
async function zalo<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ZaloApiError) throw new ZaloRejectedError(err.message, { cause: err });
    throw err;
  }
}

class ZcaSession implements ZaloSession {
  constructor(
    private readonly api: API,
    readonly uid: string,
    readonly displayName: string,
    readonly avatarUrl: string | null,
  ) {}

  async findUserByPhone(phone: string): Promise<string | null> {
    // Zalo answers "not found / not searchable" with an empty profile rather than an error.
    const user = await zalo(() => this.api.findUser(phone));
    return typeof user?.uid === 'string' && user.uid !== '' ? user.uid : null;
  }

  async sendText(uid: string, text: string): Promise<{ messageId: string }> {
    const result = await zalo(() => this.api.sendMessage(text, uid, ThreadType.User));
    const msgId = result.message?.msgId;
    if (msgId === undefined) throw new Error('Zalo returned no message id');
    return { messageId: String(msgId) };
  }

  async keepAlive(): Promise<void> {
    await zalo(() => this.api.keepAlive());
    // keepAlive does not check the login; fetching our own profile does.
    await zalo(() => this.api.fetchAccountInfo());
  }

  credentials(): ZaloCredentials {
    const ctx = this.api.getContext();
    return ZaloCredentialsSchema.parse({
      imei: ctx.imei,
      userAgent: ctx.userAgent,
      language: ctx.language,
      cookie: this.api.getCookie().toJSON()?.cookies ?? [],
    });
  }

  close(): void {
    // Nothing to release: no listener was started.
  }
}

async function toSession(api: API): Promise<ZaloSession> {
  const uid = api.getOwnId();
  const { profile } = await zalo(() => api.fetchAccountInfo());
  return new ZcaSession(api, uid, profile.displayName, profile.avatar || null);
}

export class ZcaGateway implements ZaloGateway {
  async loginWithQr(
    onEvent: (event: QrLoginEvent) => void,
    signal: AbortSignal,
  ): Promise<ZaloSession> {
    let ended: QrLoginEndReason | undefined;
    let abortQr: (() => unknown) | undefined;
    const onAbort = (): void => {
      ended ??= 'aborted';
      abortQr?.();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const api = await new Zalo(ZALO_OPTIONS).loginQR({}, (event) => {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated:
            abortQr = event.actions.abort;
            if (signal.aborted) {
              onAbort();
              return;
            }
            onEvent({ type: 'qr', image: event.data.image });
            return;
          case LoginQRCallbackEventType.QRCodeScanned:
            abortQr = event.actions.abort;
            onEvent({
              type: 'scanned',
              displayName: event.data.display_name,
              avatarUrl: event.data.avatar || null,
            });
            return;
          case LoginQRCallbackEventType.QRCodeExpired:
            // Without abort() zca-js would wait for a retry() forever.
            ended ??= 'expired';
            event.actions.abort();
            return;
          case LoginQRCallbackEventType.QRCodeDeclined:
            ended ??= 'declined';
            event.actions.abort();
            return;
          case LoginQRCallbackEventType.GotLoginInfo:
            return;
        }
      });
      return await toSession(api);
    } catch (err) {
      if (ended !== undefined) throw new QrLoginEndedError(ended, { cause: err });
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async login(credentials: ZaloCredentials): Promise<ZaloSession> {
    const api = await zalo(() => new Zalo(ZALO_OPTIONS).login(credentials));
    return toSession(api);
  }
}
