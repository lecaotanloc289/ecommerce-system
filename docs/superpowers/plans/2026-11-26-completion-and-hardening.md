# Hoàn thiện & gia cố hệ thống (đợt 8–10)

> **Cho agent thực thi:** đọc `CLAUDE.md` gốc + `CLAUDE.md` của workspace mình sửa, rồi đọc **mục "Quyết định"** và **đúng task được giao** trong file này. Không làm việc của task khác. Mỗi task kết thúc bằng: test liên quan xanh + docs cập nhật + 1..n commit Conventional Commits trên branch của worktree. Không push.

**Bối cảnh (2026-11-26):** `dev` đã có toàn bộ roadmap MVP (đợt 0–6), Zalo, vendor CRM (backend) và live shopping (backend + storefront trên mock). File này gom mọi việc còn dở + rà soát hiệu năng / bảo mật.

---

## 0. Quyết định (ràng buộc mọi task)

| #   | Quyết định                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | **Node 24 LTS** toàn hệ thống (`.nvmrc`, `engines`, Dockerfile). Đã áp dụng.                                                                                                                                                                                                                                                                                                                                        |
| H2  | **Một outbox worker duy nhất: `@workers/jobs`.** Handler `live_session.*` + job grace của live chuyển vào `workers/jobs`; xoá workspace `workers/outbox`. Mỗi event type có đúng một worker sở hữu.                                                                                                                                                                                                                 |
| H3  | **API cùng origin với từng frontend qua proxy `/v1`.** Admin (Cloudflare Pages) và storefront (Workers/OpenNext) chuyển tiếp `/v1/*` sang API; trình duyệt chỉ gọi `/v1` tương đối trên chính origin của app → cookie refresh (`SameSite=Lax`, `Path=/v1/auth`) và cookie `oauth_state` là first-party. OAuth callback vì vậy phải quay về **origin của app đã bắt đầu đăng nhập** (web hoặc admin), không cố định. |
| H4  | **SSR của storefront là client tin cậy:** gửi khoá bí mật dùng chung + IP người dùng cuối; API chỉ khi khoá đúng (so sánh timing-safe) mới tính rate-limit theo IP đó. Sai/thiếu khoá → hành vi cũ (theo IP kết nối).                                                                                                                                                                                               |
| H5  | **Refund `PENDING` được đối soát tự động:** adapter có thao tác tra cứu refund (VNPay `querydr`, Stripe `refunds.retrieve` + webhook `refund.updated`); job định kỳ trong `workers/jobs` chốt SUCCEEDED / FAILED. Không đổi quy tắc sổ cái D12.                                                                                                                                                                     |
| H6  | **Thanh toán trùng (manual review) có đường hoàn tiền trong hệ thống:** refund cấp order cho một `Payment` CONFIRMED dư, do PLATFORM_ADMIN khởi tạo; ledger `PLATFORM_ESCROW −x`, `CUSTOMER +x` (zero-sum), provider refund qua worker. Cần migration (refund không gắn sub-order).                                                                                                                                 |
| H7  | **Đơn đăng ký bán hàng mang tên shop + slug đề xuất** (`displayName`, `slug`); admin duyệt có thể sửa trước khi tạo Vendor.                                                                                                                                                                                                                                                                                         |
| H8  | **Sự kiện theo mùa cấu hình được từ admin:** bảng cấu hình theo `eventId` (bật/tắt, danh mục nổi bật là `categoryId` thật). Storefront đọc cấu hình public; không có cấu hình → gợi ý lấy sản phẩm đánh giá cao (mục không còn bị ẩn).                                                                                                                                                                              |
| H9  | **Không hiển thị ngưỡng free-ship toàn sàn** — hệ thống không có quy tắc đó (phí ship theo từng vendor). Bỏ mock `platform-settings`; benefit bar dùng nội dung không kèm con số.                                                                                                                                                                                                                                   |
| H10 | **ESLint thật ở mọi workspace** (`@repo/config/eslint`, `--max-warnings 0`); không còn script `echo 'TODO: eslint'`.                                                                                                                                                                                                                                                                                                |
| H11 | **Một test harness cho server** (`test/support/`); spec live chuyển sang harness này, bỏ project Jest `pg`.                                                                                                                                                                                                                                                                                                         |

**Quy ước chung:** như roadmap `2026-11-23-marketplace-roadmap.md` (module mỏng, schema ở `@repo/core`, `DomainError` + i18n vi/en, `@Roles`, vendor scope từ `req.user.vendorId` + re-check DB, mutation `@Idempotent()`, không `any`/`eslint-disable`).

**Migration:** không có DB dùng chung để chạy `migrate dev` trong worktree → tạo SQL bằng `prisma migrate diff --from-schema-datamodel <schema cũ> --to-schema-datamodel prisma/schema.prisma --script` (không cần DB), đặt vào thư mục có timestamp **được chỉ định trong task**, kiểm tra không có câu DROP nào của index viết tay (xem `packages/db/CLAUDE.md` "Search-index drift"). Test `@repo/db` cần Postgres: dùng Testcontainers / container tạm, **không** dùng DB local cổng 5432.

**API thay đổi:** chạy `pnpm sdk:generate` và commit `packages/sdk/openapi.json` + `src/schema.d.ts` (lead sẽ generate lại sau khi merge).

**Test:** chỉ chạy các file test liên quan tới task (Docker có sẵn cho Testcontainers; nhiều agent chạy song song nên không chạy cả bộ integration). Lead chạy gate đầy đủ sau khi merge.

---

## Đợt 8 — Nền & lỗ hổng backend (song song)

### T8.1 — Gộp live vào `@workers/jobs` (H2)

- Chuyển handler `live_session.*`, job grace (`live-disconnect-grace`), `live-events`, env live (`LIVE_STREAM_PROVIDER`, `CLOUDFLARE_STREAM_*`) và test tương ứng từ `workers/outbox` sang `workers/jobs`, viết lại theo khuôn `defineHandler` + `HandlerDeps` của `workers/jobs` (xem "Adding a handler"). Giữ nguyên hành vi đã mô tả trong `workers/outbox/CLAUDE.md` (provision idempotent với `live:provision-pending`, retire, grace re-schedule, publish realtime sau commit, lỗi provider không retry được → dead-letter).
- Xoá workspace `workers/outbox` (code, test, package, docs) và mọi tham chiếu (`CLAUDE.md` gốc, README, `server/CLAUDE.md`, `packages/db/CLAUDE.md`, `.env.example`, turbo/pnpm).
- **Xong khi:** `pnpm --filter @workers/jobs typecheck lint test` xanh; `rg "workers/outbox|@workers/outbox"` chỉ còn trong tài liệu lịch sử (`docs/superpowers/plans/*`).

### T8.2 — Một harness test cho server + test S3 (H11)

- Chuyển các spec `server/test/live/**/*.pg.spec.ts` sang `test/integration/` dùng `createTestApp` / factories của `test/support/` (thêm factory live nếu cần); xoá `test/integration/pg*.ts`, `test/live/live-test-app.ts` (nếu không còn dùng), project `pg` trong `jest.config.js`.
- Thêm test tích hợp S3 thật cho `StorageService` (presign PUT đúng/sai content-type và kích thước, presign GET, `assertOwnedKey`) bằng một container S3-compatible trong harness (khởi động lười, chỉ khi spec đó chạy).
- **Xong khi:** `pnpm --filter @server/api test` (cả unit + integration) xanh, số test live không giảm.

### T8.3 — Đối soát refund PENDING (H5)

- `@repo/payments`: thêm thao tác tra cứu trạng thái refund vào `PaymentProvider` (VNPay `querydr`, Stripe `refunds.retrieve`), test với HTTP giả.
- `server`: webhook Stripe xử lý `refund.updated` / `charge.refund.updated` (chữ ký như hiện có) → chốt Refund.
- `workers/jobs`: job định kỳ `reconcile-pending-refunds` (Refund PENDING quá N phút, theo lô, khoá order trước) → SUCCEEDED (+ `Payment` REFUNDED khi đủ điều kiện như handler hiện có) / FAILED (để admin retry). Interval qua env như các job khác.
- **Xong khi:** test adapter + job + webhook (kể cả replay) xanh; docs `packages/payments`, `workers/jobs`, `server` (mục Refunds) cập nhật, bỏ ghi chú "not resolved automatically".

### T8.4 — Refund cấp order cho thanh toán trùng (H6)

- Migration `20261126100000_add_order_level_refunds`: cho phép Refund không gắn sub-order (gắn `orderId` + `paymentId`), ràng buộc CHECK "đúng một trong sub-order hoặc order-level", unique chống refund trùng cho cùng một payment dư.
- `server`: `POST /v1/platform/payments/:id/refund-duplicate` (PLATFORM_ADMIN, `@Idempotent()`, strict rate limit): chỉ cho payment CONFIRMED **không phải** payment bán hàng của order (quy tắc `salePayment` hiện có), chưa có refund active; ledger order-level `PLATFORM_ESCROW −x`, `CUSTOMER +x` (`assertZeroSum`), outbox `refund.requested`. Danh sách "cần xử lý" cho console: `GET /v1/platform/payments/duplicates`.
- `workers/jobs`: handler `refund.requested` chấp nhận refund order-level.
- `apps/admin`: mục "Thanh toán trùng" trong trang Refunds (danh sách + nút hoàn tiền có xác nhận).
- **Xong khi:** test tích hợp (happy path, không phải duplicate → 409, lặp lại → 409/idempotent, ledger zero-sum, escrow của order về 0 sau khi payout/refund đủ) xanh; mục "Manual review" trong `server/CLAUDE.md` viết lại.

### T8.5 — Tên shop + slug trong đơn đăng ký bán hàng (H7)

- Migration `20261126110000_add_vendor_application_shop_fields` (2 cột nullable cho dữ liệu cũ); `VendorApplicationCreate` thêm `displayName`, `slug` (bắt buộc với đơn mới); server lưu + trả về; duyệt: body `VendorApprove` vẫn quyết định cuối cùng.
- `apps/client` form `/sell` thêm 2 trường (slug gợi ý từ tên); `apps/admin` trang duyệt điền sẵn từ đơn.
- **Xong khi:** test server + form helpers xanh; bỏ "Known gaps" tương ứng ở `packages/core/CLAUDE.md`.

### T8.6 — Proxy `/v1` cùng origin + OAuth callback theo app (H3)

- `apps/admin`: Cloudflare Pages Function `functions/v1/[[path]].ts` chuyển tiếp nguyên vẹn (method, headers, body, `Set-Cookie`, redirect `manual`) tới `API_ORIGIN` (biến môi trường Pages); client gọi `/v1` tương đối khi build production (dev vẫn dùng `VITE_API_URL`).
- `apps/client`: route/middleware chuyển tiếp `/v1/*` tới API trên Workers (không buffer body, giữ SSE); trình duyệt gọi `/v1` tương đối; SSR vẫn gọi thẳng `API_URL`.
- `server`: callback OAuth quay về origin của app (`app=web|admin`) — URL callback và cookie state theo app; `GOOGLE_/FACEBOOK_OAUTH_CALLBACK_URL` thay bằng cấu hình theo app (giữ tương thích local). Header `X-Forwarded-*` từ proxy: tính `TRUSTED_PROXY_HOPS` đúng (proxy thêm 1 hop). CORS giữ cho dev.
- Workflow deploy + `docs/ci-cd-plan.md` + `.env.example`: biến mới; ghi rõ redirect URI cần khai báo ở Google/Facebook console.
- **Xong khi:** test server (callback theo app, state cookie) + test proxy function (unit, fetch giả) xanh; bỏ "Known gap" đăng nhập admin ở `CLAUDE.md` gốc + `apps/admin/CLAUDE.md` (ghi lại phần còn phụ thuộc cấu hình console).

### T8.7 — SSR là client tin cậy cho rate limit (H4)

- `server`: env `SSR_CLIENT_KEY` (tuỳ chọn, ≥ 32 ký tự, cấm placeholder ở production); request có header khoá đúng (timing-safe) + header IP người dùng → bucket rate-limit theo IP đó; mọi trường hợp khác giữ `clientIp()` hiện tại. Không bao giờ tin header IP khi khoá sai.
- `apps/client` `lib/api/server.ts`: gửi khoá (server-only env, không `NEXT_PUBLIC_`) + IP người dùng lấy từ request (`CF-Connecting-IP`).
- **Xong khi:** test tích hợp rate-limit (khoá đúng → bucket theo IP người dùng; khoá sai/thiếu → không đổi; giả mạo header khi không có khoá bị bỏ qua) xanh; cập nhật "Rate limit" ở `server/CLAUDE.md` và `apps/client/CLAUDE.md`.

### T8.8 — Sự kiện theo mùa cấu hình từ admin (H8)

- Migration `20261126120000_add_seasonal_event_settings` (`event_id` PK = id trong `SEASONAL_EVENT_IDS`, `is_enabled`, `category_ids text[]`, timestamps).
- `server`: `GET /v1/seasonal-events` (public: chỉ event bật + danh mục còn tồn tại, kèm slug theo locale), `GET/PUT /v1/platform/seasonal-events/:eventId` (PLATFORM_ADMIN, `@Idempotent()`; validate eventId + categoryId tồn tại).
- `apps/admin`: mục "Sự kiện theo mùa" trong console platform.
- `apps/client`: appearance store / `SeasonalPicks` dùng cấu hình (event tắt → không trang trí; danh mục từ cấu hình; không có → sản phẩm đánh giá cao). Bỏ `categories` hardcode trong `seasonal-themes.ts`.
- **Xong khi:** test server + test store xanh; docs client/server cập nhật.

### T8.9 — Dọn storefront: benefit bar + prerender (H9)

- Bỏ `src/mocks/platform-settings.ts` và mọi chỗ dùng; benefit bar không còn con số ngưỡng (catalog i18n vi/en sửa tương ứng).
- Điều tra vì sao `next build` ra `prerender-manifest.json` rỗng (ghi ở `apps/client/CLAUDE.md` "Routes"); sửa nếu là lỗi cấu hình, nếu là hành vi đúng thì sửa lại tài liệu cho chính xác (kèm bằng chứng).
- **Xong khi:** `pnpm --filter @apps/web typecheck test build` xanh; docs cập nhật.

---

## Đợt 9 — Màn hình còn thiếu (song song; cần đợt 8 đã merge)

### T9.1 — Storefront live trên API

- `/live`, `/live/[id]` đọc `GET /v1/live-sessions…` (RSC cho danh sách/chi tiết), realtime qua SSE thật (`/v1/live-sessions/:id/events`, tự kết nối lại + refetch), chat/reaction qua `browserApi()` với `useAuth()`, sản phẩm thật (link sản phẩm + thêm vào giỏ qua `useCart`). Xoá `src/mocks/` còn lại của live.
- **Xong khi:** test logic thuần (reducer sự kiện, kết nối lại) xanh, build xanh; docs client cập nhật.

### T9.2 — Admin: live cho shop + giám sát platform

- `/vendor/live`: danh sách, tạo/lên lịch, chọn + ghim sản phẩm, lấy thông tin phát (ingest credentials, không cache), go-live / end / cancel, kiểm duyệt chat (xoá, mute). `/platform/live`: danh sách + terminate có lý do.
- **Xong khi:** test trang (Vitest, như các trang hiện có) xanh; i18n `admin.*` đủ vi/en.

### T9.3 — Storefront CRM: huỷ đăng ký, thông báo, tuỳ chọn

- `/{locale}/unsubscribe?token=&scope=` (công khai, gọi `POST /v1/crm/unsubscribe`, không lộ token vào log/analytics), chuông thông báo trên navbar + trang `/account/notifications` (đọc / đánh dấu đã đọc / đọc hết), `/account/preferences` (tuỳ chọn theo shop).
- Sau khi có trang: `.env.example` và docs worker ghi `CRM_EMAIL_ENABLED` có thể bật.
- **Xong khi:** test logic + build xanh.

### T9.4 — Admin: CRM cho shop + giám sát chiến dịch

- `/vendor/crm`: khách hàng (lọc segment/tag/tìm kiếm, chi tiết, tag, ghi chú), phân khúc, automation (3 loại), chiến dịch (tạo/sửa/preview/lên lịch/huỷ, thống kê). `/platform/crm`: danh sách chiến dịch + dừng có lý do. Quyền owner/staff theo C13.
- **Xong khi:** test trang xanh; i18n đủ.

### T9.5 — Admin: Zalo cho shop

- `/vendor/zalo`: kết nối bằng QR (poll trạng thái đăng nhập), ngắt kết nối, mẫu tin theo sự kiện (placeholder hợp lệ, delay cho AFTER_DELIVERY), nhật ký gửi (lọc trạng thái, phân trang).
- **Xong khi:** test trang xanh; i18n đủ.

---

## Đợt 10 — Chất lượng, hiệu năng, bảo mật

### T10.1 — ESLint thật ở mọi workspace (H10)

- `packages/{core,db,i18n,sdk,streaming,ui}`: `eslint.config.mjs` kế thừa `@repo/config/eslint`, script `lint` thật, sửa mọi lỗi (không `eslint-disable`).

### T10.2 — Rà soát bảo mật (tìm → kiểm chứng → sửa)

- Các lăng kính: phân quyền + ownership (IDOR, vendor scope, role cũ trong JWT), xác thực/phiên (OAuth, refresh, cookie, CSRF, CORS), đầu vào (injection trong SQL thô, upload, SSRF, XSS ở frontend, header bảo mật), tiền (race, idempotency, webhook giả, replay, làm tròn), hạ tầng (secret trong repo/log/bundle, Dockerfile, quyền workflow CI, dependency có CVE).
- Mỗi phát hiện phải có kịch bản khai thác cụ thể và được kiểm chứng độc lập trước khi sửa; sửa kèm test hồi quy.

### T10.3 — Rà soát hiệu năng & độ ổn định

- DB: truy vấn nóng không có index, N+1, transaction giữ khoá lâu; API: payload/phân trang, timeout cho mọi lời gọi ngoài; worker: backoff, dead-letter, shutdown êm; frontend: kích thước bundle, waterfall khi SSR, cache header.
- Mỗi tối ưu phải có số đo trước/sau hoặc lý do rõ ràng; không tối ưu suy đoán.

### T10.4 — Gate cuối + docs

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e` xanh; `CLAUDE.md` gốc (trạng thái, known gaps) + README + `.env.example` + `docs/ci-cd-plan.md` phản ánh đúng code.

---

## Ngoài phạm vi (cần chủ repo)

- Secret deploy (`FLY_API_TOKEN`, token Cloudflare), khai báo redirect URI ở Google/Facebook console, domain riêng.
- Merge `dev` → `prod`.
- Roadmap D15 (rút tiền tự động, FX, tranh chấp, hoàn tiền một phần, nhiều kho, gợi ý sản phẩm).
