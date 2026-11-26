# @repo/payments

Payment gateway adapters behind one `PaymentProvider` interface. Pure logic: no DB, no env reads, no
logging — config comes in through factory params, HTTP (`fetch`) and the Stripe client are injectable.
Depends on `@repo/core` (Money, enums, `DomainError`) and `stripe`. Never imports `@repo/db`, `apps/*`
or `server`.

## Layout

| Path                     | Subpath export          | What                                                                                                       |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/types.ts`           | `@repo/payments`        | `PaymentProvider`, `CreateSessionInput/Result`, `WebhookRequest/Result`, `RefundInput/Result`, `FetchLike` |
| `src/vnpay/provider.ts`  | `@repo/payments/vnpay`  | `createVnpayProvider`, `VNPAY_IPN_RESPONSE`, refund checksum field orders                                  |
| `src/vnpay/signature.ts` | `@repo/payments/vnpay`  | `vnpEncode`, `buildSignData`, `hmacSha512`, `safeEqualHex`, `formatVnpDate`, `sanitizeOrderInfo`           |
| `src/stripe/provider.ts` | `@repo/payments/stripe` | `createStripeProvider`                                                                                     |

The root export re-exports everything. All entries resolve to `dist/` (tsup, ESM + CJS + d.ts).

## Interface

```ts
interface PaymentProvider {
  id: 'VNPAY' | 'STRIPE';
  currencies: readonly Currency[];
  createSession(i: {
    paymentId;
    orderId;
    amount: Money;
    returnUrl;
    ipAddr;
    locale;
    description;
  }): Promise<{ redirectUrl; providerRef; expiresAt: Date }>;
  verifyWebhook(req: { headers; rawBody; query }): WebhookResult; // sync, no I/O
  refund(i: {
    refundId;
    paymentId;
    providerTxnId;
    providerRef;
    amount;
    paymentAmount;
    reason;
    initiatedBy;
  }): Promise<{ providerRefundId; status: 'SUCCEEDED' | 'PENDING' | 'FAILED'; failureCode; raw }>;
}
type WebhookResult =
  | { status: 'CONFIRMED' | 'FAILED'; paymentId; providerTxnId; amount: Money; raw }
  | { status: 'IGNORED'; eventType; raw };
```

- `verifyWebhook` only proves authenticity and maps the outcome. It returns the provider-reported `amount`
  as Money; **the server compares `paymentId` + `amount` against the `Payment` row** (and raises
  `payment.error.amount-mismatch` itself).
- `providerRef` from `createSession` must be persisted with the Payment: VNPay's refund needs it.
- Errors are `DomainError`s: `payment.error.signature-invalid` (bad/missing signature, or an authentic
  message that is not a payment result for us), `payment.error.amount-mismatch` (unparseable amount,
  refund > paid), `payment.error.provider-unavailable` (network, 401/403/409/429/5xx, malformed reply —
  retry with backoff), `common.error.validation-failed` (the provider refused the request itself, e.g.
  Stripe 400 on createSession, or VNPay refund without `providerRef` — don't retry),
  `money.error.currency-mismatch` (currency the adapter isn't configured for), `money.error.invalid-operand`
  (amount ≤ 0).
- `refund` returns `FAILED` when the provider refuses (don't retry), `PENDING` when the refund is in flight
  or was already requested, and throws `provider-unavailable` on transient failures. `PENDING` is not
  resolved automatically yet: it needs a follow-up (VNPay `querydr`, Stripe `refund.updated` webhook) or a
  manual reconcile.
- `raw` is the full verified provider payload (Stripe events include customer email/address). Store only
  what you need in `Payment.rawPayload`.

## VNPay (`createVnpayProvider`) — API v2.1.0, VND only

Config: `{ tmnCode, hashSecret, payUrl, apiUrl, sessionTtlMinutes = 15, orderType = 'other',
serverIpAddr = '127.0.0.1', fetch?, now? }`.

- **Signing rule** (pay URL, IPN, return URL): take the `vnp_*` params with a non-empty value, drop
  `vnp_SecureHash` / `vnp_SecureHashType`, sort keys in ASCII order, form-urlencode each key and value
  (Java `URLEncoder` / PHP `urlencode` semantics: keep `A-Za-z0-9.-*_`, space → `+`, other UTF-8 bytes →
  `%XX`), join `k=v` with `&`; `vnp_SecureHash` = lower-case hex HMAC-SHA512 of that string with the hash
  secret. The URL query is the same string plus `&vnp_SecureHash=…`. `encodeURIComponent` is **wrong**
  here (`%20` instead of `+`, keeps `!'()~`). Verification compares with `timingSafeEqual`
  (case-insensitive hex).
- `vnp_Amount` = minor units × 100 (max 12 digits); verification divides by 100 and rejects a non-multiple.
- `vnp_CreateDate` / `vnp_ExpireDate` are `yyyyMMddHHmmss` in GMT+7. `vnp_TxnRef` = `paymentId`.
- `vnp_OrderInfo` is sanitized: diacritics stripped (đ → d), only `A-Za-z0-9 .-_:` kept, max 255.
- Success = `vnp_ResponseCode === '00'` **and** `vnp_TransactionStatus === '00'`; anything else is `FAILED`.
  A validly signed query is still rejected (`signature-invalid`) unless `vnp_TmnCode` is ours and both
  codes are present — otherwise our own outbound pay URL could be replayed to the IPN route as a `FAILED`
  result. `CONFIRMED` also requires a `vnp_TransactionNo`.
- The same `verifyWebhook` serves the IPN and the browser return URL, but **only the IPN may change
  Payment state**: the return URL is delivered by the client, so the return route displays/redirects only.
- **IPN reply**: VNPay expects HTTP 200 + JSON `{ RspCode, Message }` — use `VNPAY_IPN_RESPONSE`
  (`success` 00, `orderNotFound` 01, `alreadyConfirmed` 02, `invalidAmount` 04, `invalidSignature` 97,
  `unknownError` 99). 00/02 end VNPay's retries; the others make it retry (up to 10×, 5 min apart).
- **Refund** (`POST apiUrl`, JSON, `vnp_Command=refund`): `vnp_RequestId` = `refundId`,
  `vnp_TransactionType` `02` full / `03` partial (amount < `paymentAmount`), `vnp_TransactionNo` =
  `providerTxnId`, `vnp_TransactionDate` = the pay request's `vnp_CreateDate` (= `providerRef`),
  `vnp_CreateBy` = `initiatedBy`, `vnp_IpAddr` = `serverIpAddr`. Checksum = HMAC-SHA512 of the values
  joined with `|` in `REFUND_REQUEST_HASH_FIELDS` order (RequestId|Version|Command|TmnCode|TransactionType|
  TxnRef|Amount|TransactionNo|TransactionDate|CreateBy|CreateDate|IpAddr|OrderInfo). A `00` reply must carry
  a valid checksum over `REFUND_RESPONSE_HASH_FIELDS` and echo this request's `vnp_TxnRef` + `vnp_Amount`
  (a replayed signed success is rejected). Codes: `00` → SUCCEEDED, `94` (duplicate) → PENDING,
  `02/03/91/95/97` → FAILED, `99`/other/HTTP error → throws `provider-unavailable`.

## Stripe (`createStripeProvider`) — USD + VND

Config: `{ secretKey, webhookSecret, client?, currencies = ['USD','VND'], sessionTtlMinutes = 30,
webhookToleranceSeconds = 300, now? }`.

- Checkout Session, `mode: 'payment'`, one line item, `client_reference_id` + `metadata.paymentId` =
  `paymentId` (also on `payment_intent_data.metadata`), `success_url` = `cancel_url` = `returnUrl`,
  `expires_at` = now + TTL (Stripe allows 30 min..24 h). No explicit idempotency key: `expires_at` differs
  per worker retry and Stripe rejects a reused key with different params (stripe-node still keys its own
  network retries). A session orphaned by a lost response is harmless — nobody has its URL; it expires.
- Amounts pass through unchanged: our Money is cents for USD and đồng for VND, which Stripe treats as
  zero-decimal.
- Webhook: `stripe.webhooks.constructEvent(rawBody, stripe-signature header, webhookSecret)` — needs the
  **exact raw body bytes**. Mapping: `checkout.session.completed` / `async_payment_succeeded` with
  `payment_status: 'paid'` → CONFIRMED (`providerTxnId` = PaymentIntent id); `checkout.session.expired` /
  `async_payment_failed` → FAILED; everything else (and sessions without our `paymentId`) → IGNORED.
  `payment_intent.payment_failed` is deliberately IGNORED: a declined card is not terminal for a Checkout
  Session (the customer can retry in the same session until it expires).
- Refund: `refunds.create({ payment_intent: providerTxnId, amount })`, idempotency key `refund:<refundId>`
  (params are deterministic per refund). `succeeded` → SUCCEEDED, `pending`/`requires_action` → PENDING,
  `failed`/`canceled` or a 400/402/404 refusal → FAILED; 401/403/409/429/5xx/network/idempotency errors →
  throws `provider-unavailable`.

## Wiring (server / workers)

Consumers read env (Zod-validated) and build the providers once, e.g. a Nest provider / worker singleton:

```ts
const providers = {
  VNPAY: createVnpayProvider({
    tmnCode: env.VNPAY_TMN_CODE,
    hashSecret: env.VNPAY_HASH_SECRET,
    payUrl: env.VNPAY_PAY_URL,
    apiUrl: env.VNPAY_API_URL,
  }),
  STRIPE: createStripeProvider({
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  }),
} satisfies Record<PaymentProvider['id'], PaymentProvider>;
```

Env names (in root `.env.example`): `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_PAY_URL`,
`VNPAY_API_URL`, `VNPAY_RETURN_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

- **Worker `payment.requested`** (roadmap D2): `createSession(...)` → write `redirectUrl`, `expiresAt` and
  persist `providerRef`. `ipAddr` must be the customer's IP captured at checkout (VNPay requires it).
- **Webhook routes** (`server`): Stripe route needs the raw body; VNPay IPN is a GET — pass the parsed query.
  Map `signature-invalid` to 400 (Stripe) / `VNPAY_IPN_RESPONSE.invalidSignature` (VNPay).
- **Refund worker**: pass `providerTxnId` + `providerRef` from the Payment, `refundId` as idempotency id.

## Commands

- `pnpm --filter @repo/payments lint` — ESLint (shared type-checked config)
- `pnpm --filter @repo/payments typecheck` — `tsc` for `src/` and `test/`
- `pnpm --filter @repo/payments test` — Vitest; HTTP is mocked, no network or services needed
- `pnpm --filter @repo/payments build` — tsup → `dist/` (needs `@repo/core` built first)
