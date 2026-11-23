import type { ZaloCredentials } from './credentials.js';

// Port between the worker and zca-js (unofficial Zalo web API). The real adapter is
// `zca-gateway.ts`; tests use a fake. Everything Zalo-specific stays behind this interface.

export type QrLoginEvent =
  /** `image` is a base64 PNG (no data-URL prefix). */
  | { type: 'qr'; image: string }
  | { type: 'scanned'; displayName: string; avatarUrl: string | null };

export type QrLoginEndReason = 'expired' | 'declined' | 'aborted';

/** The QR flow ended without a session (QR expired, user declined on the phone, or we aborted). */
export class QrLoginEndedError extends Error {
  override readonly name = 'QrLoginEndedError';
  constructor(
    readonly reason: QrLoginEndReason,
    options?: { cause?: unknown },
  ) {
    super(`QR login ended: ${reason}`, options);
  }
}

/**
 * Zalo answered with an error (as opposed to a network failure / timeout). Only these count towards
 * marking an account EXPIRED — a network outage must not force every shop to re-scan its QR.
 */
export class ZaloRejectedError extends Error {
  override readonly name = 'ZaloRejectedError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class ZaloTimeoutError extends Error {
  override readonly name = 'ZaloTimeoutError';
}

/** Rejects with ZaloTimeoutError after `ms` (the underlying call keeps running; its result is ignored). */
export async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ZaloTimeoutError(`${what} timed out after ${ms} ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A logged-in Zalo account. Methods throw ZaloRejectedError when Zalo refuses the call. */
export interface ZaloSession {
  readonly uid: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  /** Zalo uid of the user registered with this phone, or null when none / not searchable. */
  findUserByPhone(phone: string): Promise<string | null>;
  sendText(uid: string, text: string): Promise<{ messageId: string }>;
  /** Pings Zalo; throws when the session is no longer valid (or on network errors). */
  keepAlive(): Promise<void>;
  /** Current cookies etc. — Zalo may rotate cookies, so persist after a keep-alive. */
  credentials(): ZaloCredentials;
  /** Releases local resources (zca-js keeps none for send-only use). */
  close(): void;
}

export interface ZaloGateway {
  /** Runs the QR flow; resolves once the phone confirmed, rejects with QrLoginEndedError otherwise. */
  loginWithQr(onEvent: (event: QrLoginEvent) => void, signal: AbortSignal): Promise<ZaloSession>;
  /** Restores a session from stored credentials; throws when Zalo rejects them. */
  login(credentials: ZaloCredentials): Promise<ZaloSession>;
}
