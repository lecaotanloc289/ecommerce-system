# Marketplace Roadmap — từ nền móng đến MVP đa người bán

> **Cho agent thực thi:** đọc `CLAUDE.md` gốc + `CLAUDE.md` của workspace mình sửa, rồi đọc **mục "Quyết định kiến trúc"** và **đúng task được giao** trong file này. Không làm việc của task khác. Mỗi task kết thúc bằng: test xanh + docs cập nhật + 1..n commit Conventional Commits trên branch của worktree.

**Mục tiêu MVP:** khách mua hàng từ nhiều vendor trong một đơn, trả qua VNPay/Stripe; tiền vào escrow; vendor xử lý sub-order; sau khi COMPLETED + hết hold period thì tiền (trừ commission) vào ví vendor; platform duyệt vendor, kiểm duyệt sản phẩm, chỉnh tham số, hoàn tiền.

**Trạng thái xuất phát (2026-11-23):** DB schema + migrations + seed; `@repo/core` (Money, ids, enums, errors, schema address/category/product/cart/checkout); `@repo/i18n`; `@repo/ui`; server có auth (OAuth, JWT, refresh xoay vòng, guards). Storefront 12 màn hình trên mock. Admin, SDK, payments, workers: chưa có.

---

## 0. Quyết định kiến trúc (ràng buộc mọi task)

| #   | Quyết định                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Storefront render SSR trên Cloudflare Workers** qua `@opennextjs/cloudflare` (bỏ `output: 'export'`). Locale chuyển sang `next-intl` route prefix `/vi`, `/en` + middleware. Data đọc (catalog) fetch trong RSC; mutation qua client SDK (access token trong memory).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D2  | **Tạo phiên thanh toán ở worker**, không trong request thread (Golden Rule #9). Checkout trả `Order` + `Payment{status: PENDING, redirectUrl: null}`; worker xử lý outbox `payment.requested` → gọi `PaymentProvider.createSession` → ghi `Payment.redirectUrl`. Client poll `GET /v1/orders/:id/payment` (1s, tối đa 30s) rồi redirect.                                                                                                                                                                                                                                                                                                                                                                                                  |
| D3  | **Ledger escrow IN ghi lúc thanh toán được xác nhận** (webhook), không phải lúc checkout — tiền chưa về thì không ghi sổ. Checkout chỉ reserve kho + ghi order + outbox. (Cập nhật bước 9d trong `CLAUDE.md` §4 cho khớp.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D4  | **Kho:** checkout `UPDATE product_variants SET stock_reserved = stock_reserved + qty WHERE id = ? AND stock_on_hand - stock_reserved >= qty` (0 row → `checkout.error.out-of-stock`). Paid: `stock_on_hand -= qty, stock_reserved -= qty`. Huỷ/hết hạn: `stock_reserved -= qty`.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D5  | **Commission** tính lúc checkout, snapshot vào `SubOrder.commissionAmount`. bps mỗi dòng = `vendor.commissionBpsOverride ?? min(category.commissionBpsOverride của product) ?? PlatformSettings.commissionBps`. Base = line total sau khi trừ phần giảm giá **vendor tài trợ** (coupon VENDOR). Coupon PLATFORM do platform chịu, không giảm base commission.                                                                                                                                                                                                                                                                                                                                                                             |
| D6  | **Một đơn = một currency.** Mọi variant phải cùng currency, nếu không → `checkout.error.currency-mismatch`. Không có FX trong MVP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D7  | **Công thức tiền mỗi sub-order** `i`: `paid_i = subtotal + shipping − vendorDiscount − platformDiscount_i`; `net_i = subtotal + shipping − vendorDiscount − commission`. Ledger khi paid (per sub-order, 1 txnGroup): `CUSTOMER −paid_i`, `PLATFORM_ESCROW +paid_i`. Payout: `PLATFORM_ESCROW −paid_i`, `VENDOR_WALLET +net_i`, `PLATFORM_REVENUE +(commission − platformDiscount_i)`. Mọi group zero-sum (`assertZeroSum`).                                                                                                                                                                                                                                                                                                              |
| D8  | **Platform coupon** chia cho các sub-order theo tỷ lệ subtotal-sau-vendor-discount bằng `Money.allocate` (largest remainder). Số coupon cộng dồn ≤ `PlatformSettings.maxCouponStack` (tính trên toàn đơn).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D9  | **Idempotency** (Golden Rule #3): interceptor `@Idempotent()` — Redis `idem:{userId}:{key}` lưu `{hash body, status, response}` TTL 24h; đang xử lý → 409 `idempotency.error.in-progress`; cùng key khác body → 422 `idempotency.error.key-reused`; replay trả lại response cũ. `Order.idempotencyKey` unique là lưới an toàn ở DB.                                                                                                                                                                                                                                                                                                                                                                                                       |
| D10 | **Workers** là workspace riêng `workers/jobs` (`@workers/jobs`), phụ thuộc `@repo/db`, `@repo/core`, `@repo/payments`, `@repo/i18n`. Không import từ `server`. Outbox poll `FOR UPDATE SKIP LOCKED` + BullMQ cho retry/backoff + repeatable jobs (cron).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D11 | **Vòng đời SubOrder:** `AWAITING_PAYMENT → PAID` (webhook) `→ PROCESSING` (vendor nhận) `→ SHIPPED` (vendor nhập carrier + tracking) `→ DELIVERED` (vendor/khách xác nhận) `→ COMPLETED` (khách xác nhận hoặc tự động sau `refundWindowDays`). `CANCELLED` từ AWAITING_PAYMENT (khách huỷ / hết hạn thanh toán). `REFUNDED` từ PAID..DELIVERED (admin). Order.status suy ra từ các sub-order.                                                                                                                                                                                                                                                                                                                                             |
| D12 | **Refund MVP:** chỉ admin khởi tạo, hoàn **toàn bộ** một sub-order (`paid_i`). Bảng `Refund`; worker gọi provider refund; ledger `PLATFORM_ESCROW −paid_i`, `CUSTOMER +paid_i`; trả kho nếu chưa ship.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D13 | **Upload:** presigned PUT URL tới S3-compatible (R2 prod / container local). Bucket `kyc` private (đọc bằng presigned GET, chỉ platform staff), bucket `media` public cho ảnh sản phẩm/logo. Key có prefix theo user/vendor; server kiểm tra key thuộc người gọi trước khi lưu.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D14 | **Vendor staff:** owner mời qua email → `VendorInvitation` (token băm, hết hạn 7 ngày); người nhận đăng nhập bằng email **đã verify** trùng khớp mới accept được → `UserRole VENDOR_STAFF`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D15 | **Ngoài phạm vi MVP:** rút tiền về ngân hàng tự động, FX, quy trình tranh chấp, refund một phần, multi-warehouse, gợi ý sản phẩm. (Zalo được đưa vào phạm vi ngày 2026-11-23 — xem D16.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D16 | **Tin nhắn Zalo tự động theo shop** (quyết định 2026-11-23, thay phần "Zalo" của D15): mỗi vendor đăng nhập Zalo cá nhân bằng QR qua `workers/zalo` (zca-js — API không chính thức, chấp nhận rủi ro khoá tài khoản), cấu hình mẫu tin cho từng sự kiện (đặt đơn, mỗi trạng thái sub-order, chăm sóc sau giao N phút). Chỉ nhắn khách đã tick opt-in lúc checkout (`Order.zaloOptIn`), gửi tới SĐT trong địa chỉ giao. Hàng đợi riêng `zalo_messages` ghi cùng transaction (ngoại lệ Golden Rule #9). **Mọi task ghi `SubOrder.status` (T3.1 webhook, fulfilment, refund, auto-complete) phải gọi `queueZaloStatusMessages(tx, …)` trong cùng transaction.** Chi tiết: `workers/zalo/CLAUDE.md`, `server/CLAUDE.md` "Zalo notifications". |

**Phân công model:** _opus_ = khó/nhiều ràng buộc (tiền, transaction, bảo mật, hạ tầng mới); _sonnet_ = đã đặc tả rõ; _haiku_ = tài liệu/việc cơ học. Sau mỗi đợt: merge vào `dev` → `code-reviewer` (sonnet) review diff của đợt → sửa lỗi thật → gate `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

**Quy ước chung cho mọi task server:**

- Mỗi module: `xxx.module.ts`, `xxx.controller.ts` (mỏng), `xxx.service.ts` (logic), `xxx.repository.ts` khi query phức tạp. Đăng ký vào `app.module.ts` (sửa kiểu cộng thêm).
- Request/response schema ở `packages/core/src/schemas/*` (Golden Rule #1); controller dùng `createZodDto` + khai báo response cho OpenAPI.
- Lỗi nghiệp vụ: `throw new DomainError('<code>', params)`; mã mới thêm vào `packages/core/src/errors` **và** bản dịch vi/en trong `packages/i18n` (compiler bắt thiếu).
- Mọi endpoint bảo vệ có `@Roles(...)`; vendor scope lấy từ `req.user.vendorId` và **re-check `Vendor.status = ACTIVE` trong DB** trước thao tác ghi.
- Test tích hợp: Jest + Testcontainers (Postgres 16 + Redis 7) qua harness của T0.2 — **không** chạy test truncate vào DB local dùng chung.

---

## Đợt 0 — Nền móng (song song)

### T0.1 — DB: các cột/bảng vận hành còn thiếu · **opus**

- **Mục tiêu:** một migration forward-only bổ sung đủ trường cho mọi đợt sau, để các branch song song không đụng `schema.prisma`.
- **DB (migration `add_marketplace_ops_fields`):**
  - `Payment`: `redirectUrl String?`, `expiresAt DateTime?`.
  - `Order`: `paymentDeadlineAt DateTime?`.
  - `SubOrder`: `platformDiscountAmount BigInt @default(0)`, `carrier String?`, `trackingNumber String?`, `shippedAt`, `deliveredAt`, `cancelledAt DateTime?`.
  - `PlatformSettings`: `paymentTimeoutMinutes Int @default(30)`.
  - `ProductStatus` thêm `BLOCKED`; `Product.blockedReason String?`.
  - `Vendor.suspendedReason String?`.
  - `OutboxEvent.nextAttemptAt DateTime @default(now())` + index `(processedAt, nextAttemptAt)`.
  - Bảng mới `Refund` (`refunds`): id, subOrderId, paymentId, amount BigInt, currency, status `RefundStatus {PENDING, SUCCEEDED, FAILED}`, reason, providerRefundId?, requestedById, timestamps; index subOrderId/status.
  - Bảng mới `VendorInvitation` (`vendor_invitations`): id, vendorId, email (lowercase), tokenHash @unique, invitedById, expiresAt, acceptedAt?, acceptedById?, revokedAt?, timestamps; index vendorId.
  - Re-export enum mới (`RefundStatus`) từ `@repo/db`; mirror enum trong `@repo/core/enums` + ids (`RefundId`, `VendorInvitationId`).
- **Seed:** bổ sung cho dữ liệu demo đủ chạy luồng: ≥2 vendor ACTIVE, mỗi vendor ≥1 ShippingMethod, ≥3 product ACTIVE có variant + stock, 1 platform coupon + 1 vendor coupon, user PLATFORM_ADMIN demo. Vẫn idempotent.
- **Test:** `pnpm --filter @repo/db test` xanh (seed idempotency + ledger invariant); `prisma migrate status` sạch; test core enum mirror.
- **Xong khi:** migration SQL nằm trong PR, `packages/db/CLAUDE.md` cập nhật.

### T0.2 — Server platform: idempotency, rate limit, test harness, ESLint · **opus**

- **Mục tiêu:** hạ tầng dùng chung cho mọi module server.
- **Service/infra:**
  - `src/common/idempotency/`: `IdempotencyInterceptor` + decorator `@Idempotent()` theo D9 (header `Idempotency-Key` validate bằng `IdempotencyKeySchema` của core; thiếu → 400 `idempotency.error.key-required`).
  - Rate limit `@fastify/rate-limit` dùng Redis store; mặc định 100 req/phút/IP, endpoint nhạy cảm (checkout, payments, auth) chặt hơn; vượt → 429 `common.error.rate-limited` qua `DomainErrorFilter`.
  - `src/common/pagination.ts`: helper cursor pagination (ULID cursor) + schema `PageQuerySchema`/`PageSchema(item)` đặt ở `@repo/core/schemas/common.ts`.
  - `test/support/`: harness Testcontainers khởi Postgres (chạy `prisma migrate deploy`) + Redis một lần mỗi file test; helper `createTestApp()` dựng Nest app Fastify với env test; factory dữ liệu (`makeUser`, `makeVendor`, `makeProduct`, `signAccessToken(user, roles)`).
  - ESLint thật cho `server` (thay `echo 'TODO: eslint'`) dùng `@repo/config/eslint`; sửa hết lỗi lint hiện có.
- **Test:** interceptor (lần đầu, replay, in-progress, key-reused, thiếu key), rate limit trả 429, harness có 1 test mẫu chạy được.
- **Xong khi:** `pnpm --filter @server/api lint typecheck test build` xanh; `server/CLAUDE.md` mô tả harness + idempotency.

### T0.3 — Core: toàn bộ schema còn thiếu · **sonnet**

- **Mục tiêu:** mọi shape request/response của MVP có trong `@repo/core` để server/SDK/frontend dùng chung.
- **Schema mới** (`packages/core/src/schemas/`): `vendor.ts` (VendorPublic, VendorApplicationCreate/Read, VendorReject), `order.ts` (Order, SubOrder, OrderItem, OrderSummary list item, PaymentSession `{status, redirectUrl, expiresAt}`, SubOrderShip `{carrier, trackingNumber}`), `shipping-method.ts` (read + upsert), `coupon.ts` (read + create/update cho vendor & platform), `review.ts` (create + read + RatingSummary), `platform-settings.ts` (public read, admin read/update), `wallet.ts` (Wallet, LedgerEntry read), `refund.ts`, `vendor-invitation.ts`, `upload.ts` (PresignRequest `{purpose: 'kyc'|'product-image'|'vendor-logo', contentType, size}` → `{url, key, headers}`), `me.ts` (+ chuyển `TokenResponse`, `MeResponse` từ `server/src/auth/auth.schemas.ts` sang core và cho server import lại — xoá TODO), `product-admin.ts` (ProductUpsert cho vendor: translations vi/en, variants, images, categoryIds).
- **Error codes mới** (+ HTTP status + bản dịch vi/en): `address.error.not-found`, `vendor.error.suspended`, `vendor.error.not-found`, `product.error.blocked`, `sub-order.error.not-found`, `review.error.not-eligible`, `review.error.already-exists`, `upload.error.invalid-key`, `upload.error.content-type-not-allowed`, `upload.error.too-large`, `invitation.error.invalid`, `invitation.error.expired`, `invitation.error.email-mismatch`, `refund.error.not-refundable`, `payment.error.session-not-ready`.
- **Test:** mỗi schema ≥1 case hợp lệ + ≥1 không hợp lệ (Vitest); i18n test bắt đủ bản dịch.
- **Xong khi:** `pnpm --filter @repo/core --filter @repo/i18n test typecheck build` xanh; `packages/core/CLAUDE.md` liệt kê schema mới.
- **Lưu ý:** chỉ đụng `packages/core`, `packages/i18n`, và `server/src/auth/auth.schemas.ts` (đổi import).

### T0.4 — OpenAPI → `@repo/sdk` · **sonnet**

- **Mục tiêu:** pipeline sinh SDK typed từ server, chạy được ngay với các route auth/health hiện có.
- **Infra:** `@nestjs/swagger` + `nestjs-zod` `cleanupOpenApiDoc`; script `server` `openapi:export` dựng app không listen (không cần DB/Redis thật — mock provider) và ghi `packages/sdk/openapi.json`; `@repo/sdk`: `openapi-typescript` sinh `src/schema.d.ts` + client mỏng dựa trên `openapi-fetch` với `createApiClient({ baseUrl, getAccessToken, onUnauthorized })` (tự gắn Bearer, `credentials: 'include'`, tự sinh `Idempotency-Key` ULID cho POST/PUT/PATCH nếu caller không truyền, single-flight `POST /v1/auth/refresh` khi 401 rồi retry 1 lần). Re-export schema Zod từ `@repo/core`.
- **Turbo:** task `@repo/sdk#generate` phụ thuộc build server; CI chạy và fail nếu `openapi.json` lệch (git diff --exit-code).
- **Test:** Vitest cho client: gắn header, single-flight refresh (2 request song song → 1 refresh), retry sau refresh, sinh idempotency key.
- **Xong khi:** `pnpm --filter @repo/sdk build test` xanh; README/CLAUDE.md có lệnh `pnpm sdk:generate`.

### T0.5 — Storefront chuyển SSR trên Workers · **opus**

- **Mục tiêu:** D1 — app chạy SSR bằng OpenNext, sẵn sàng fetch dữ liệu động.
- **Việc:** bỏ `output: 'export'`/`trailingSlash`/`distDir` hack; thêm `@opennextjs/cloudflare`, `wrangler.jsonc`, script `preview`/`deploy`; chuyển locale sang `next-intl` với `app/[locale]/...`, middleware `/vi` `/en` (mặc định vi), giữ catalog từ `@repo/i18n` (không trùng lặp chuỗi); bỏ `LocaleProvider` + localStorage locale; `deploy-web.yml` đổi sang `opennextjs-cloudflare build && deploy` (Workers). Mock data vẫn giữ (đợt 4 mới nối API).
- **Test:** `pnpm --filter @apps/web build` + `opennextjs-cloudflare build` thành công; chạy `next start` hoặc `preview`, curl `/vi`, `/en/product/<slug-mock>` trả 200 và đúng ngôn ngữ.
- **Xong khi:** `apps/client/CLAUDE.md` + `docs/ci-cd-plan.md` cập nhật phần deploy web.

---

## Đợt 1 — Đọc dữ liệu & khối nghiệp vụ thuần (song song; cần đợt 0)

### T1.1 — Catalog API (public) · **sonnet**

- **Mục tiêu:** storefront đọc được toàn bộ catalog thật.
- **API** (public, `?locale=vi|en`, mặc định vi): `GET /v1/categories` (cây), `GET /v1/categories/:slug` (+ breadcrumb), `GET /v1/products` (filter `categorySlug`, `vendorSlug`, `minPrice`, `maxPrice`, `sort=newest|price_asc|price_desc|rating`, cursor pagination), `GET /v1/products/:slug` (variant `stockAvailable`, ảnh, vendor rút gọn, rating summary), `GET /v1/search?q=` (tsvector `websearch_to_tsquery` + `pg_trgm` similarity fallback, raw SQL tham số hoá trong repository), `GET /v1/vendors/:slug` (+ sản phẩm), `GET /v1/platform-settings/public` (defaultCurrency, supportedCurrencies).
- **Service:** chỉ trả product `ACTIVE` của vendor `ACTIVE`; không lộ `stockOnHand/stockReserved`; BigInt → `Money` qua `toMoney`.
- **Test tích hợp:** lọc theo category, product DRAFT/BLOCKED/vendor SUSPENDED bị ẩn, search vi có dấu/không dấu, pagination ổn định, slug sai → 404 `product.error.not-found`.

### T1.2 — Address + profile API · **sonnet**

- **API** (`CUSTOMER`): `GET/POST /v1/me/addresses`, `PATCH/DELETE /v1/me/addresses/:id`, `POST /v1/me/addresses/:id/default`; `PATCH /v1/me` (name, primaryLocale).
- **Service:** ownership theo `req.user.id` (địa chỉ người khác → 404, không 403); đặt default trong `$transaction` (bỏ default cũ); địa chỉ đầu tiên tự là default; xoá default → địa chỉ mới nhất thành default.
- **Test:** CRUD, ownership, invariant đúng 1 default.

### T1.3 — Cart API + gộp giỏ guest · **sonnet**

- **API** (`CUSTOMER`): `GET /v1/cart` (dòng nhóm theo vendor, giá hiện tại, `stockAvailable`, cờ `unavailable`), `PUT /v1/cart/items/:variantId {quantity}`, `DELETE /v1/cart/items/:variantId`, `POST /v1/cart/merge {items[]}` (gộp guest cart: cộng dồn, kẹp theo tồn kho, bỏ variant không tồn tại/không bán), `GET /v1/cart/shipping-options` (ShippingMethod active của từng vendor trong giỏ).
- **Service:** tạo `Cart` lười; giá không lưu ở cart (luôn đọc DB); quantity > stock → `cart.error.quantity-exceeds-stock`.
- **Test:** merge idempotent khi gọi lặp, kẹp tồn kho, nhóm vendor, product bị BLOCKED đánh dấu unavailable.

### T1.4 — `@repo/payments`: VNPay + Stripe adapters · **opus**

- **Mục tiêu:** logic cổng thanh toán thuần, không DB.
- **Interface:** `PaymentProvider { id; createSession(input: {paymentId, orderId, amount: Money, returnUrl, ipAddr, locale, description}): Promise<{redirectUrl, providerRef?, expiresAt}>; verifyWebhook(req: {headers, rawBody, query}): WebhookResult; refund(input): Promise<{providerRefundId, status}> }` với `WebhookResult = {paymentId, providerTxnId, status: 'CONFIRMED'|'FAILED', amount: Money, raw}`.
- **VNPay:** build URL ký HMAC-SHA512 (sắp key, encode đúng spec v2.1.0, amount ×100), verify IPN/return (so `vnp_SecureHash`, `vnp_ResponseCode`/`vnp_TransactionStatus` = `00`), refund API (`/merchant_webapi/api/transaction`). Chỉ VND.
- **Stripe:** Checkout Session (amount minor unit, USD/VND zero-decimal xử lý đúng), verify webhook bằng `stripe.webhooks.constructEvent` (raw body), event `checkout.session.completed`/`checkout.session.expired`/`payment_intent.payment_failed`, refund qua `refunds.create`. `fetch`/Stripe client được inject để test.
- **Config:** nhận config qua tham số factory (`createVnpayProvider({tmnCode, hashSecret, payUrl, apiUrl})`), không đọc env trong package.
- **Test (Vitest, HTTP mock):** chữ ký đúng/sai, sửa 1 tham số → sai chữ ký, amount mismatch, mã lỗi VNPay ≠ 00 → FAILED, Stripe signature sai → throw `payment.error.signature-invalid`.

### T1.5 — Pricing engine trong `@repo/core` · **sonnet**

- **Mục tiêu:** toàn bộ toán tiền của checkout/payout là hàm thuần, test kỹ (D5, D7, D8).
- **Hàm** (`packages/core/src/pricing/`): `resolveCommissionBps({vendorOverride, categoryOverrides, platformBps})`; `evaluateCoupon(coupon, ctx)` → lý do từ chối bằng error code (`not-started`, `expired`, `min-spend-not-met`, `usage-limit-reached`); `priceOrder({subOrders: [{vendorId, lines: [{unitPrice, qty, commissionBps}], shipping}], vendorCoupons, platformCoupons, maxCouponStack, now})` → per sub-order `{subtotal, shipping, vendorDiscount, platformDiscount, commission, paid, net}` + tổng đơn; `computePayoutPostings(subOrder)` → 3 posting zero-sum.
- **Quy tắc:** PERCENT là bps (`applyBps`, làm tròn xuống có lợi cho khách? → **floor** discount), FIXED không vượt base; vendor coupon chỉ áp vào sub-order của vendor đó; platform discount chia bằng `Money.allocate`; commission làm tròn **half-even** (ghi rõ trong code); discount không bao giờ làm `paid < 0`.
- **Test:** 1 vendor, 2 vendor, coupon vendor + platform, vượt stack, FIXED > subtotal, PERCENT 100%, chia dư largest-remainder, commission override, mọi kết quả `paid = net + commission − platformDiscount` và payout zero-sum.

### T1.6 — Storage/upload + S3 local · **sonnet**

- **Mục tiêu:** D13.
- **Infra:** `docker-compose.yml` thay `minio/minio` (Docker Hub không còn cho pull) bằng image S3-compatible còn hoạt động (ưu tiên `quay.io/minio/minio` nếu pull được, nếu không thì `rustfs/rustfs` hoặc `chrislusf/seaweedfs` mode s3) + job tạo bucket `kyc` (private) và `media` (public read); env `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_KYC`, `S3_BUCKET_MEDIA`, `MEDIA_PUBLIC_BASE_URL` vào `env.ts` + `.env.example`.
- **API:** `POST /v1/uploads/presign` (`CUSTOMER` cho `kyc`; `VENDOR_OWNER|VENDOR_STAFF` cho `product-image`/`vendor-logo`): kiểm content-type (jpeg/png/webp/pdf cho kyc), size ≤ 10MB, key `kyc/{userId}/{ulid}.{ext}` hoặc `media/vendors/{vendorId}/{ulid}.{ext}`, URL hết hạn 5 phút.
- **Service:** `StorageService.assertOwnedKey(key, owner)`, `presignGet(key)` cho KYC (staff xem), `publicUrl(key)`.
- **Test:** từ chối content-type/size, key prefix theo người gọi, assertOwnedKey chặn key của người khác; test S3 thật qua Testcontainers chỉ nếu image ổn định, không thì mock client.

---

## Đợt 2 — Checkout & vendor onboarding (cần đợt 1)

### T2.1 — Checkout + đơn hàng phía khách · **opus**

- **Mục tiêu:** lõi hệ thống — Golden Rules #3, #4, #9.
- **API** (`CUSTOMER`): `POST /v1/orders/checkout` (`@Idempotent()`, body `CheckoutSchema`), `GET /v1/orders` (cursor), `GET /v1/orders/:id` (của mình), `GET /v1/orders/:id/payment` (PaymentSession; chưa có URL → 202 `payment.error.session-not-ready`), `POST /v1/orders/:id/cancel` (chỉ khi mọi sub-order AWAITING_PAYMENT), `POST /v1/orders/:id/payments` (thử lại thanh toán khi attempt trước FAILED/hết hạn: Payment attemptNo+1 + outbox).
- **Service `checkoutCart` (một `$transaction`, isolation mặc định + lock dòng):** đọc PlatformSettings; load variants + product + vendor + categories; kiểm ACTIVE/không BLOCKED/vendor ACTIVE; kiểm cùng currency (D6); address của user (→ snapshot JSON); nhóm theo vendor, mỗi vendor đúng 1 shipping method thuộc vendor đó (`missing`/`invalid`); load coupons theo code (platform + vendor), đếm redemption (`maxRedemptions`, `perUserLimit`) với `SELECT ... FOR UPDATE` trên coupon; gọi `priceOrder` (T1.5); reserve kho (D4); insert Order (`paymentDeadlineAt = now + paymentTimeoutMinutes`), SubOrders (snapshot commission/discount), OrderItems (snapshot title theo locale người dùng + attributes + unit price), CouponRedemptions, Payment PENDING attempt 1; outbox `order.created` + `payment.requested`. Commit → trả Order.
- **Hàm dùng chung:** `deriveOrderStatus(subOrderStatuses)` (thuần, đặt ở `packages/core/src/orders/`, có test) — T3.1/T3.3/T3.5 dùng lại; hàm huỷ đơn đặt trong `server/src/orders/order-cancellation.ts` với chữ ký nhận `Prisma.TransactionClient` để worker (T3.2) có thể mô phỏng cùng hợp đồng.
- **Huỷ:** transaction: sub-orders CANCELLED + `cancelledAt`, nhả `stock_reserved`, xoá CouponRedemption (hoàn lượt dùng), Payment PENDING → FAILED, outbox `order.cancelled`.
- **Test tích hợp:** 1 vendor; 2 vendor → 2 sub-order đúng tiền; out-of-stock rollback toàn bộ (không reserve lẻ); 2 checkout đồng thời tranh dòng kho cuối → 1 thành công; idempotency replay trả cùng order, khác body → 422; coupon hết lượt; shipping method của vendor khác → invalid; giá lấy DB dù client gửi gì; huỷ nhả kho; người khác xem đơn → 404.

### T2.2 — Workers: scaffold + outbox dispatcher + payment session + email · **opus**

- **Mục tiêu:** D2, D10; mọi side effect chạy ngoài request thread.
- **Workspace `workers/jobs`** (`@workers/jobs`, thêm vào `pnpm-workspace.yaml`, Turbo, Dockerfile + fly.toml riêng hoặc process thứ 2 — ghi rõ trong CLAUDE.md của workspace): config Zod env, pino, Prisma từ `@repo/db`, BullMQ connection Redis.
- **Outbox dispatcher:** vòng poll (1s) `SELECT ... WHERE processed_at IS NULL AND next_attempt_at <= now() ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED` trong transaction → enqueue BullMQ job (jobId = outbox id để chống trùng) → đánh dấu processed; handler lỗi → `attempts+1`, `lastError`, `nextAttemptAt` backoff mũ (tối đa 10 lần rồi để dead-letter: log error + giữ nguyên).
- **Handlers:** `payment.requested` → `PaymentProvider.createSession` → ghi `Payment.redirectUrl/expiresAt` (nếu Payment không còn PENDING thì bỏ qua); `order.created`/`order.paid`/`order.cancelled`/`sub-order.shipped`/`vendor.application.approved|rejected` → email qua nodemailer (SMTP Mailhog local) với template text/HTML dùng `@repo/i18n` theo `primaryLocale` người nhận (thêm key i18n `email.*`).
- **Test:** dispatcher không xử lý trùng khi 2 worker chạy song song (Testcontainers Postgres), backoff sau lỗi, handler payment ghi redirectUrl (provider mock), email render đúng ngôn ngữ (transport mock).

### T2.3 — Vendor application (KYC) + duyệt · **sonnet**

- **API:** `POST /v1/vendor-applications` (`CUSTOMER`; KYC key phải thuộc user — `assertOwnedKey`; đã có PENDING → `vendor.error.application-already-pending`; đã là vendor owner → 409), `GET /v1/vendor-applications/me`; platform (`PLATFORM_STAFF|PLATFORM_ADMIN`): `GET /v1/platform/vendor-applications?status=`, `GET /v1/platform/vendor-applications/:id` (kèm presigned GET cho ảnh KYC, che bớt số tài khoản/ CCCD trong list), `POST .../:id/approve {slug, displayName}` , `POST .../:id/reject {reason}`.
- **Service approve (`$transaction`):** application PENDING → APPROVED (+ reviewer, reviewedAt; không PENDING → `vendor.error.application-not-pending`), tạo Vendor ACTIVE (slug unique → 409), Wallet (currency = defaultCurrency), UserRole VENDOR_OWNER, outbox `vendor.application.approved`. Reject: REJECTED + reason + outbox.
- **Test:** luồng nộp → duyệt → user có role VENDOR_OWNER + vendorId trong JWT mới; reject; duyệt 2 lần; customer gọi API platform → 403; slug trùng.

### T2.4 — Vendor catalog API (sản phẩm + vận chuyển) · **sonnet**

- **API** (`VENDOR_OWNER|VENDOR_STAFF`, scope `req.user.vendorId`, re-check vendor ACTIVE): `GET/POST /v1/vendor/products`, `GET/PUT /v1/vendor/products/:id` (ProductUpsert: translations vi+en bắt buộc vi, slug unique theo locale, variants upsert theo sku, images theo key đã upload, categoryIds), `POST /v1/vendor/products/:id/publish` (DRAFT/ARCHIVED → ACTIVE; cần ≥1 variant giá > 0, BLOCKED → `product.error.blocked`), `POST .../:id/archive`, `PATCH /v1/vendor/variants/:id/stock {stockOnHand}` (không nhỏ hơn stockReserved); `GET/POST /v1/vendor/shipping-methods`, `PUT .../:id`, `POST .../:id/deactivate`.
- **Service:** mọi thao tác trong `$transaction`; không bao giờ nhận `vendorId` từ client; cập nhật `primaryImageUrl` = ảnh sortOrder nhỏ nhất; search vector tự cập nhật bằng trigger sẵn có (kiểm chứng).
- **Test:** vendor A không đọc/sửa được product vendor B (404), slug trùng, publish thiếu variant, giảm stock dưới reserved, vendor SUSPENDED bị chặn ghi.

---

## Đợt 3 — Thanh toán, vận hành đơn, platform (cần đợt 2)

### T3.1 — Webhook thanh toán · **opus**

- **API:** `POST /v1/payments/webhook/stripe` (raw body — cấu hình Fastify content parser giữ raw cho route này), `GET /v1/payments/webhook/vnpay` (IPN, trả JSON `{RspCode, Message}` đúng spec), `GET /v1/payments/return/vnpay` (browser return: chỉ verify chữ ký rồi redirect về `WEB_ORIGIN/{locale}/order/success?orderId=` — **không** đổi trạng thái).
- **Service `confirmPayment` (một `$transaction`, idempotent):** verify qua `@repo/payments`; tìm Payment theo paymentId, `SELECT ... FOR UPDATE`; đã CONFIRMED → trả OK (không ghi lại); amount/currency khác → `payment.error.amount-mismatch` (log + FAILED); CONFIRMED: Payment CONFIRMED + providerTxnId + rawPayload; Order PAID; sub-orders PAID; kho `on_hand -= qty, reserved -= qty`; ledger theo D7 (mỗi sub-order 1 txnGroup, `assertZeroSum`); outbox `order.paid`. Nếu order đã CANCELLED (hết hạn) mà tiền vẫn về → tự tạo Refund PENDING + outbox `refund.requested`. FAILED → Payment FAILED (đơn vẫn chờ, khách có thể thử lại).
- **Test:** chữ ký sai → 400 không ghi gì; replay webhook 2 lần → 1 bộ ledger; amount sai; ledger zero-sum; tiền về sau khi huỷ → refund tự động; IPN response đúng format VNPay.

### T3.2 — Jobs định kỳ: hết hạn, tự hoàn tất, payout · **opus**

- **Trong `@workers/jobs`** (BullMQ repeatable, mỗi job khoá phân tán qua jobId cố định):
  - `expire-unpaid-orders` (mỗi phút): order AWAITING_PAYMENT quá `paymentDeadlineAt` → huỷ như T2.1 (dùng chung logic: tách hàm huỷ sang `packages/db` repository hoặc viết lại trong worker theo cùng hợp đồng — ghi rõ chọn gì).
  - `auto-complete-sub-orders` (mỗi giờ): DELIVERED và `deliveredAt + refundWindowDays <= now` → COMPLETED + `completedAt`.
  - `release-payouts` (mỗi giờ): COMPLETED, `payoutReleasedAt IS NULL`, `completedAt + holdPeriodDays <= now`, không có Refund PENDING/SUCCEEDED → transaction từng sub-order: ledger payout (D7, `computePayoutPostings`), `Wallet.balance += net` (`UPDATE ... SET balance = balance + ?`), `payoutReleasedAt = now`, outbox `payout.released`.
  - `refund.requested` handler (dùng ở T3.5): gọi `provider.refund` → Refund SUCCEEDED/FAILED.
- **Test:** biên hold period (đúng 7 ngày - 1s chưa trả, +1s trả), chạy job 2 lần không trả 2 lần, sub-order có refund không trả, auto-complete biên, expire nhả kho.

### T3.3 — Vendor fulfillment + ví · **opus**

- **API** (vendor scope): `GET /v1/vendor/sub-orders?status=` (cursor), `GET /v1/vendor/sub-orders/:id` (items, shipping address snapshot, khách: tên + phone), `POST .../:id/accept` (PAID→PROCESSING), `POST .../:id/ship {carrier, trackingNumber}` (PROCESSING→SHIPPED), `POST .../:id/deliver` (SHIPPED→DELIVERED); khách: `POST /v1/orders/:orderId/sub-orders/:id/confirm-received` (SHIPPED|DELIVERED→COMPLETED); `GET /v1/vendor/wallet` (balance + `pending` = tổng net của sub-order PAID..COMPLETED chưa payout), `GET /v1/vendor/ledger` (cursor). Ví chỉ `VENDOR_OWNER`.
- **Service:** state machine một chỗ (`sub-order-state.ts` — bảng chuyển trạng thái, sai → `order.error.invalid-status-transition`); mỗi chuyển kèm timestamp + outbox (`sub-order.shipped`, …); cập nhật Order.status suy ra (D11) trong cùng transaction; cập nhật đồng thời dùng điều kiện `WHERE status = <from>` để chống race.
- **Test:** toàn bộ ma trận chuyển hợp lệ/không hợp lệ, vendor khác → 404, staff không xem ví, Order.status suy ra đúng khi 2 sub-order khác trạng thái.

### T3.4 — Platform admin API · **sonnet**

- **API:** `GET /v1/platform/settings`, `PATCH /v1/platform/settings` (chỉ ADMIN; validate commissionBps 0..10000, holdPeriodDays ≥ 0…); `GET /v1/platform/vendors?status=`, `POST /v1/platform/vendors/:id/suspend {reason}`, `POST .../:id/reactivate`; `GET /v1/platform/products?status=&vendorId=`, `POST /v1/platform/products/:id/block {reason}`, `POST .../:id/unblock` (→ DRAFT); `GET /v1/platform/orders?status=&q=`, `GET /v1/platform/orders/:id` (kèm payments, ledger, refunds); `GET /v1/platform/users?q=`, `POST /v1/platform/users/:id/roles {role: PLATFORM_STAFF|PLATFORM_ADMIN}` / `DELETE .../roles/:role` (chỉ ADMIN, không tự gỡ quyền ADMIN của chính mình).
- **Test:** quyền STAFF vs ADMIN, suspend vendor → sản phẩm biến mất khỏi catalog, block product, không tự gỡ ADMIN.

### T3.5 — Refund (admin) · **opus**

- **API:** `POST /v1/platform/sub-orders/:id/refund {reason}` (ADMIN, `@Idempotent()`).
- **Service:** sub-order ở PAID..DELIVERED và chưa payout, không có Refund khác đang PENDING/SUCCEEDED → `refund.error.not-refundable`; transaction: Refund PENDING (amount = paid_i), sub-order REFUNDED, nhả/hoàn kho nếu chưa SHIPPED (`on_hand += qty`), ledger `PLATFORM_ESCROW −paid_i`, `CUSTOMER +paid_i` (txnGroup riêng), Order.status suy ra (PARTIALLY_REFUNDED/REFUNDED), outbox `refund.requested`. Worker (T3.2) gọi provider.
- **Test:** refund 1/2 sub-order → PARTIALLY_REFUNDED; refund sau payout bị chặn; double refund bị chặn; ledger zero-sum; kho trả đúng.

### T3.6 — Reviews · **sonnet**

- **API:** `POST /v1/products/:id/reviews {subOrderId, rating 1..5, body?}` (`CUSTOMER`; sub-order của mình, DELIVERED|COMPLETED, chứa product → không thì `review.error.not-eligible`; trùng → `review.error.already-exists`), `GET /v1/products/:id/reviews` (public, cursor) + rating summary (avg, count, phân bố 1-5) dùng ở T1.1.
- **Test:** đủ điều kiện/không đủ, trùng, summary đúng.

### T3.7 — Vendor staff invitations · **sonnet**

- **API:** `POST /v1/vendor/invitations {email}` (OWNER), `GET /v1/vendor/invitations`, `POST /v1/vendor/invitations/:id/revoke`, `GET /v1/vendor/staff`, `DELETE /v1/vendor/staff/:userId`; người nhận: `POST /v1/vendor-invitations/accept {token}` (CUSTOMER đã đăng nhập).
- **Service:** token 32 byte ngẫu nhiên, lưu sha256; email lowercase; accept kiểm token, hạn, chưa revoke/accept, `User.email` (đã verify) == email mời → tạo UserRole VENDOR_STAFF; outbox `vendor.invitation.created` (email chứa link `ADMIN_ORIGIN/invite?token=`).
- **Test:** accept sai email, hết hạn, revoke, dùng lại token, staff không mời được.

---

## Đợt 4 — Khung frontend (cần SDK + API đợt 1-3)

### T4.1 — Storefront: auth + SDK + catalog thật · **opus**

- **Việc:** `src/lib/api/` server client (RSC, `NEXT_PUBLIC_API_URL`, revalidate ngắn cho catalog) + browser client (`@repo/sdk`, access token trong memory/Zustand không persist, single-flight refresh lúc mount); sign-in/register → nút Google/Facebook trỏ `GET /v1/auth/google|facebook?returnTo=`; trang callback nhận access token theo hợp đồng của auth module; header hiện user + đăng xuất. Thay mock bằng API cho home, categories, search, product detail (variant chọn được, hết hàng disable), vendor page mới `/[locale]/vendors/[slug]`. Xoá type mock tương ứng trong `src/types.ts`, dùng type core. `generateMetadata` cho SEO product/category.
- **Test:** Vitest cho auth store (single-flight); Playwright smoke: home → category → product (API thật chạy với seed, auth OAuth mock).

### T4.2 — Admin: scaffold · **opus**

- **Việc:** React Router 7 (`/vendor/*`, `/platform/*`, `/login`, `/invite`), layout + sidebar từ `@repo/ui`, TanStack Query + `@repo/sdk`, auth store (memory, single-flight refresh), route guard theo role (`VENDOR_*` → /vendor, `PLATFORM_*` → /platform; nhiều role → chọn), i18n `@repo/i18n` (namespace `admin.*`), ESLint + Vitest thật (thay echo TODO), trang dashboard rỗng mỗi khu.
- **Test:** guard chuyển hướng đúng theo role (Vitest + Testing Library), build xanh.

## Đợt 5 — Màn hình (song song; cần đợt 4)

### T5.1 — Storefront: giỏ hàng + checkout + đơn hàng · **sonnet**

- Cart page: guest dùng localStorage như cũ; đăng nhập → gọi `POST /v1/cart/merge` một lần rồi dùng server cart. Checkout info (chọn/thêm địa chỉ), shipping (chọn phương thức **theo từng vendor**), payment (VNPay/Stripe), review (nhập coupon, tổng do server tính — dùng preview hoặc hiển thị theo `priceOrder` client-side chỉ để xem, số cuối cùng là của server), Place order: gửi `Idempotency-Key` cố định cho lần bấm đó, poll `GET /orders/:id/payment`, redirect. Order success + track order đọc API (timeline từ status + timestamps + tracking). Trang `/account/orders`, `/account/orders/[id]` (nút "Đã nhận hàng", huỷ, thanh toán lại).
- Checkout gửi `zaloOptIn` từ `useCheckout().zaloOptIn` (checkbox ở bước Review đã có, mặc định tắt — D16).
- **Test:** Playwright: guest thêm giỏ → đăng nhập (mock) → giỏ gộp → checkout 2 vendor → trang chờ thanh toán (provider sandbox mock) → success.

### T5.2 — Storefront: tài khoản, đăng ký bán hàng, review · **sonnet**

- `/account` (profile, ngôn ngữ), `/account/addresses` (CRUD + default), `/sell` (form đăng ký vendor: upload KYC qua presign, trạng thái đơn đăng ký), form review trên trang đơn đã giao, danh sách review + rating trên trang product.
- **Test:** Vitest component cho form (validate bằng schema core), Playwright smoke nộp đơn vendor.

### T5.3 — Admin: vendor portal · **sonnet**

- `/vendor/products` (list, tạo/sửa với translations vi/en, variants, upload ảnh, publish/archive, chỉnh tồn kho), `/vendor/orders` (list theo trạng thái, chi tiết, accept/ship/deliver), `/vendor/shipping`, `/vendor/wallet` (số dư, pending, ledger), `/vendor/staff` (mời, thu hồi), `/invite` accept.
- `/vendor/zalo` (D16, API `server/CLAUDE.md` "Zalo notifications"): thẻ tài khoản (trạng thái ACTIVE/EXPIRED/DISCONNECTED, tên + avatar, lastSeenAt; EXPIRED → nhắc quét lại), nút **Kết nối / Quét lại** (chỉ owner) → `POST /v1/vendor/zalo/login-requests` rồi poll `GET …/login-requests/:loginId` mỗi 1s: hiện `qrImage`, SCANNED → "xác nhận trên điện thoại", SUCCESS/EXPIRED/DECLINED/FAILED (`already-linked` → báo số Zalo đã gắn shop khác), dừng poll khi rời trang; nút ngắt kết nối (owner, confirm); form mẫu tin cho từng `ZaloMessageEvent` (bật/tắt, textarea với chèn nhanh các `placeholders`, preview bằng `renderZaloTemplate` với dữ liệu mẫu, `delayMinutes` chỉ cho AFTER_DELIVERY, lỗi 422 `zalo.error.unknown-placeholder`); bảng nhật ký `GET /v1/vendor/zalo/messages` (lọc status, `skipReason` dịch qua i18n). Staff chỉ xem + sửa mẫu tin.
- **Test:** Vitest component các form chính; Playwright smoke: vendor tạo sản phẩm → publish.

### T5.4 — Admin: platform console · **sonnet**

- `/platform/applications` (duyệt/từ chối, xem KYC), `/platform/vendors` (suspend/reactivate), `/platform/products` (block/unblock), `/platform/orders` (tìm, chi tiết, refund sub-order), `/platform/settings` (chỉ ADMIN), `/platform/users` (cấp/gỡ role).
- **Test:** Playwright smoke: admin duyệt đơn vendor.

## Đợt 6 — Hoàn thiện

### T6.1 — E2E xuyên hệ thống + CI · **sonnet**

- Playwright chạy với API + worker thật (docker services) và provider mock: customer mua 2 vendor → webhook mock → vendor ship/deliver → customer confirm → chạy job payout với clock giả → ví vendor tăng đúng `net`. CI: job integration (Testcontainers) + e2e; kiểm `openapi.json` không lệch.

### T6.2 — Docs đồng bộ · **haiku**

- Cập nhật `CLAUDE.md` gốc (Implementation status, bước 9d theo D3, monorepo map thêm `workers/`), README (setup, lệnh mới), `.env.example` (đủ biến mới), `docs/ci-cd-plan.md` (worker deploy, web Workers). Chỉ phản ánh code đã có, không bịa.

---

## Thứ tự & song song

```
Đợt 0: T0.1 ║ T0.2 ║ T0.3 ║ T0.4 ║ T0.5
Đợt 1: T1.1 ║ T1.2 ║ T1.3 ║ T1.4 ║ T1.5 ║ T1.6
Đợt 2: T2.1 ║ T2.2 ║ T2.3 ║ T2.4
Đợt 3: T3.1 ║ T3.2 ║ T3.3 ║ T3.4 ║ T3.5 ║ T3.6 ║ T3.7
Đợt 4: T4.1 ║ T4.2            (+ regenerate SDK trước)
Đợt 5: T5.1 ║ T5.2 ║ T5.3 ║ T5.4
Đợt 6: T6.1 ║ T6.2
```

Sau mỗi đợt: merge các branch vào `dev` (giải xung đột ở file đăng ký chung: `app.module.ts`, `schemas/index.ts`, `errors`, catalog i18n), `pnpm sdk:generate`, gate đầy đủ, review bằng `code-reviewer`, sửa lỗi, commit.

---

## Progress (2026-11-24)

Trạng thái theo code và `CLAUDE.md` của từng workspace. Các mục chưa khớp đặc tả ghi ở cột "Ghi chú"; section trên không sửa.

| Task                                        | Trạng thái | Ghi chú                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T0.1 DB ops fields                          | done       | Thêm `Refund` (partial unique: tối đa 1 refund không FAILED/sub-order), `VendorInvitation`, `OutboxEvent.nextAttemptAt`.                                                                                                                                           |
| T0.2 Server platform                        | done       | Idempotency, rate limit, Testcontainers harness. Gap: rate limit của SSR storefront dùng chung bucket IP egress (`server/CLAUDE.md`).                                                                                                                              |
| T0.3 Core schemas                           | done       | Gap: `VendorApplicationCreate` chưa có `displayName` / `slug` (bảng application chưa có cột).                                                                                                                                                                      |
| T0.4 OpenAPI → SDK                          | done       | `pnpm sdk:generate`; CI có drift check.                                                                                                                                                                                                                            |
| T0.5 Storefront SSR trên Workers            | done       | OpenNext, locale qua `next-intl` (D1). `docs/ci-cd-plan.md` chưa cập nhật (ngoài danh sách file của T6.2).                                                                                                                                                         |
| T1.1 Catalog API                            | done       | Chỉ trả sản phẩm ACTIVE của vendor ACTIVE.                                                                                                                                                                                                                         |
| T1.2 Address + profile                      | done       | Module `me`.                                                                                                                                                                                                                                                       |
| T1.3 Cart + gộp giỏ guest                   | done       | Gộp một lần khi đăng nhập.                                                                                                                                                                                                                                         |
| T1.4 `@repo/payments`                       | done       | VNPay (HMAC-SHA512) + Stripe; adapter không đọc env, không truy cập DB.                                                                                                                                                                                            |
| T1.5 Pricing engine                         | done       | `packages/core/src/pricing` theo D5–D8.                                                                                                                                                                                                                            |
| T1.6 Upload + S3 local                      | done       | Presigned PUT (D13); RustFS thay MinIO ở local.                                                                                                                                                                                                                    |
| T2.1 Checkout                               | done       | Lệch D3 có chủ đích: ledger escrow IN ghi khi thanh toán được xác nhận, checkout chỉ tạo `Payment` PENDING.                                                                                                                                                        |
| T2.2 Workers + outbox                       | done       | Lệch D10: không dùng BullMQ cho từng event. Dispatcher claim trực tiếp bảng outbox (`FOR UPDATE SKIP LOCKED`), chỉ claim event type có handler; BullMQ chỉ cho job định kỳ. Zero-amount đơn được worker xác nhận. `sub-order.completed` chưa có handler (chờ CRM). |
| T2.3 Vendor application (KYC)               | done       | Duyệt bởi platform staff.                                                                                                                                                                                                                                          |
| T2.4 Vendor catalog + shipping              | done       | Vendor scope lấy từ `req.user` (không tin `vendorId` của client).                                                                                                                                                                                                  |
| T3.1 Webhook thanh toán                     | done       | Xác nhận trong một transaction; Zalo được xếp hàng trong cùng transaction.                                                                                                                                                                                         |
| T3.2 Jobs định kỳ                           | done       | Expiry, auto-complete, release payout, retention. Không có fake clock: test và E2E dịch dữ liệu rồi chạy `run-job`.                                                                                                                                                |
| T3.3 Fulfilment + ví                        | done       | Accept / ship / deliver, khách xác nhận, ví có ledger.                                                                                                                                                                                                             |
| T3.4 Platform admin API                     | done       | Duyệt vendor, kiểm duyệt sản phẩm, settings, role.                                                                                                                                                                                                                 |
| T3.5 Refund (admin)                         | done       | Hoàn toàn bộ một sub-order (D12). Lệch: không có đối soát tự động (VNPay `querydr`, Stripe `refund.updated` chưa làm); refund PENDING phải đối soát tay.                                                                                                           |
| T3.6 Reviews                                | done       | Tên tác giả được che (`maskAuthorName`).                                                                                                                                                                                                                           |
| T3.7 Vendor staff invitations               | done       | Lưu hash token, hết hạn, chấp nhận khi email đã verify khớp.                                                                                                                                                                                                       |
| T4.1 Storefront auth + SDK + catalog        | done       | Giỏ guest lưu localStorage. Ngưỡng free-shipping còn mock (`src/mocks/platform-settings.ts`). Wishlist, blog, brand chưa có.                                                                                                                                       |
| T4.2 Admin scaffold                         | done       | Gap: admin và API khác site trên deploy hiện tại nên refresh cookie không bám (`apps/admin/CLAUDE.md`).                                                                                                                                                            |
| T5.1 Storefront giỏ + checkout + đơn        | done       | Poll `GET /v1/orders/:id` sau thanh toán; retry thanh toán.                                                                                                                                                                                                        |
| T5.2 Storefront tài khoản, bán hàng, review | done       | Các màn đăng nhập (địa chỉ, sell, review) chưa nằm trong E2E.                                                                                                                                                                                                      |
| T5.3 Admin vendor portal                    | done       | `/vendor/*`: sản phẩm, đơn, vận chuyển, ví, nhân viên.                                                                                                                                                                                                             |
| T5.4 Admin platform console                 | done       | `/platform/*`: duyệt hồ sơ, vendor, sản phẩm, đơn, refund, settings, user.                                                                                                                                                                                         |
| T6.1 E2E + CI                               | done       | Flow `00`–`05` (`e2e/`); CI `e2e.yml`; flow thanh toán dùng gateway giả và IPN VNPay ký thật.                                                                                                                                                                      |
| T6.2 Docs đồng bộ                           | done       | Cập nhật `CLAUDE.md` §1/§3/§11/§13, `README.md`, `.env.example`. Chưa làm: `docs/ci-cd-plan.md`.                                                                                                                                                                   |
| D16 Zalo (ngoài đợt)                        | done       | Server module, `workers/zalo`, opt-in ở checkout. Rủi ro: zca-js không chính thức; một tài khoản Zalo mỗi shop; chỉ gửi text (`workers/zalo/CLAUDE.md`).                                                                                                           |
