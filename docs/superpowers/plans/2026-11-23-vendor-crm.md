# CRM cho shop — chăm sóc khách sau mua (Đợt 7)

> **Cho agent thực thi:** đọc `CLAUDE.md` gốc + `CLAUDE.md` của workspace mình sửa, rồi đọc **§1 Quyết định**, **§2 Hợp đồng chung** và **đúng task được giao**. Không làm việc của task khác. Roadmap chung: `docs/superpowers/plans/2026-11-23-marketplace-roadmap.md` (mọi quy ước ở đó vẫn áp dụng: D9 `@Idempotent()`, harness `server/test/support`, re-check vendor ACTIVE…).

**Mục tiêu:** mỗi shop có CRM riêng để chăm sóc khách **đã mua của shop**: hồ sơ khách 360, phân khúc, tin tự động sau mua, chiến dịch gửi coupon theo phân khúc. Mọi liên lạc đi **qua nền tảng** (thông báo in-app + email), shop **không** thấy email / số điện thoại khách.

**Nền:** branch `feat/crm` từ `roadmap/integration` (đã có orders, payments, reviews, coupons, vendor catalog, platform admin, idempotency, harness test). **Phụ thuộc chưa có:** T3.3 (vendor fulfillment — phát event giao hàng), T2.2 `@workers/jobs` (dispatcher + email). Vì vậy đợt này làm **K1–K4 + K6** ngay; **K5 (worker CRM)** làm khi `@workers/jobs` vào integration.

---

## 1. Quyết định (ràng buộc mọi task CRM)

| #   | Quyết định                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **"Khách của shop"** = user có ≥ 1 `SubOrder` của vendor ở trạng thái `PAID, PROCESSING, SHIPPED, DELIVERED, COMPLETED` (gọi là _đơn hợp lệ_). `REFUNDED`, `CANCELLED`, `AWAITING_PAYMENT` không tính. Thống kê **tính lúc đọc** bằng SQL tổng hợp trên `sub_orders ⋈ orders` (index mới `sub_orders(vendor_id, status)`); chưa materialize — ghi giới hạn quy mô trong `server/CLAUDE.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| C2  | **Chi tiêu** của khách tại shop = Σ `paid_i = subtotal + shipping − discount − platformDiscount` trên đơn hợp lệ, **nhóm theo currency** (trả `Money[]`). **Phân khúc không dùng tiền** (tránh lẫn currency).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| C3  | **Phân khúc** (hàm thuần `classifyCustomer` ở core; SQL lọc phải cho kết quả giống hệt — có test đối chiếu): `LAPSED` nếu lần mua cuối > `crmLapsedAfterDays` (180) ngày; ngược lại `AT_RISK` nếu > `crmAtRiskAfterDays` (60); ngược lại `VIP` nếu số đơn ≥ `crmVipMinOrders` (3); `RETURNING` nếu ≥ 2; còn lại `NEW`. Ngưỡng nằm trong `PlatformSettings`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| C4  | **Quyền riêng tư (NĐ 13/2023):** API CRM chỉ trả `customerId`, `name`, `avatarUrl`, tỉnh/thành (từ snapshot địa chỉ giao gần nhất), số liệu mua, sản phẩm đã mua **ở shop này**, review của khách **trên sản phẩm shop này**, tag/ghi chú nội bộ. **Không bao giờ** email, số điện thoại, địa chỉ chi tiết. Khách không phải khách của shop → 404 `crm.error.not-a-customer` (không lộ sự tồn tại).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| C5  | **Hai loại tin:** `SERVICE` (cảm ơn sau giao, mời đánh giá) — gửi trừ khi khách đã tắt tin dịch vụ của shop đó; `MARKETING` (nhắc mua lại, chiến dịch) — **chỉ** gửi khi khách **đã chủ động đồng ý** nhận ưu đãi của shop (`marketingOptInAt` có, chưa opt-out). Mặc định: chưa đồng ý. **Điều kiện đồng ý marketing:** `marketing_opt_in_at IS NOT NULL AND (marketing_opt_out_at IS NULL OR marketing_opt_in_at > marketing_opt_out_at)`; dịch vụ được gửi khi `service_opt_out_at IS NULL`. Mọi thay đổi đồng ý còn ghi thêm một dòng **append-only** vào `crm_consent_events` (hành động `ConsentAction` + nguồn + thời điểm) để chứng minh theo NĐ 13.                                                                                                                                                                                                   |
| C6  | **Kênh:** `IN_APP` (bảng `notifications`, khách đọc qua `/v1/me/notifications`) + `EMAIL` (qua transport email của `@workers/jobs`, chỉ khi user có email). Zalo **không** dùng cho CRM (rủi ro khoá tài khoản khi gửi hàng loạt); có thể thêm sau cho tin SERVICE qua `queueZaloMessages` của nhánh Zalo. Không pixel theo dõi mở mail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| C7  | **Nội dung do shop viết:** văn bản thuần, `vi` bắt buộc (≤ 1000 ký tự), `en` tuỳ chọn (thiếu → dùng `vi`). Placeholder duy nhất: `{customerName}`, `{shopName}`, `{couponCode}`. **Cấm link** (`http://`, `https://`, `www.`, dạng `domain.tld/…`) → `crm.error.links-not-allowed` — chống lừa đảo và kéo khách ra ngoài sàn; nền tảng tự gắn nút/link (trang shop, viết đánh giá, dùng coupon). Kiểm link trên văn bản đã chuẩn hoá NFKC (bắt cả dấu chấm Unicode, IP, `scheme://`, link rút gọn). Giá trị thay vào `{shopName}` / `{couponCode}` cũng bị kiểm; coupon gắn vào CRM phải có mã dạng `^[A-Z0-9_-]{3,32}$`. Template có `{couponCode}` bắt buộc gắn coupon (thiếu → `crm.error.unknown-placeholder`); template mặc định của nền tảng không chứa `{couponCode}` — khi có coupon, nền tảng tự thêm dòng/nút dùng mã. Email escape HTML khi render. |
| C8  | **Tự động hoá** (mỗi shop 1 dòng/loại, mặc định tắt): `THANK_YOU` (SERVICE, kích hoạt `sub-order.delivered`, trễ 0–7 ngày); `REVIEW_REQUEST` (SERVICE, `sub-order.delivered`, 1–30 ngày; bỏ qua nếu khách đã review mọi sản phẩm của sub-order); `REORDER_REMINDER` (MARKETING, `sub-order.completed`, 7–180 ngày; bỏ qua nếu khách đã có đơn hợp lệ mới ở shop sau mốc kích hoạt; được gắn coupon). Template rỗng → dùng mặc định của nền tảng từ `@repo/i18n` theo ngôn ngữ khách.                                                                                                                                                                                                                                                                                                                                                                           |
| C9  | **Lịch gửi bền vững trong DB:** mọi tin là một dòng `crm_messages` (`SCHEDULED` + `scheduledFor`). Worker quét tin đến hạn bằng `FOR UPDATE SKIP LOCKED`, **kiểm lại điều kiện lúc gửi** (vendor ACTIVE, automation còn bật, consent, sub-order không bị REFUNDED, đã review / đã mua lại, giới hạn tần suất) → `SENT` hoặc `SKIPPED` + `skipReason`. Không dùng job trễ của BullMQ cho CRM.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C10 | **Chiến dịch:** `DRAFT → SCHEDULED → SENDING → SENT`, huỷ được ở `DRAFT/SCHEDULED` (`CANCELLED`). Đối tượng = bộ lọc (phân khúc, tag, đã mua sản phẩm, mua trong N ngày) **∩ khách đã đồng ý marketing**, tính **lúc gửi**. Mỗi shop ≤ `crmMaxCampaignsPerWeek` (2) chiến dịch lên lịch / 7 ngày trượt. Coupon gắn kèm phải là coupon VENDOR của chính shop, đang active, còn hiệu lực tại thời điểm gửi.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C11 | **Giới hạn tần suất:** mỗi khách nhận ≤ `crmMaxMarketingPerCustomerPerWeek` (2) tin MARKETING / shop / 7 ngày trượt; vượt → `SKIPPED(FREQUENCY_CAP)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| C12 | **Huỷ đăng ký:** mỗi email có link tới trang storefront `/{locale}/unsubscribe?token=…` (trang này POST, vì trình quét mail hay tự mở GET) + header `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058) trỏ `POST /v1/crm/unsubscribe`. Token **tất định** cho mỗi cặp (khách, shop): `base64url(HMAC-SHA256(CRM_UNSUBSCRIBE_SECRET, userId:vendorId))` (`deriveUnsubscribeToken` ở core) — server và worker tự tính lại, link trong mọi email cũ vẫn dùng được; DB lưu sha256 của token để tra cứu (`unsubscribe_token_hash`). Đổi secret = vô hiệu mọi link cũ (chỉ làm khi lộ secret).                                                                                                                                                                                                                                                                  |
| C13 | **Quyền shop:** `VENDOR_OWNER` + `VENDOR_STAFF` xem khách, tag, ghi chú, phân khúc, xem chiến dịch/tự động hoá; **chỉ `VENDOR_OWNER`** bật/sửa tự động hoá và lên lịch / huỷ chiến dịch. Platform staff xem và huỷ chiến dịch (chống lạm dụng).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 2. Hợp đồng chung

### 2.1 Enum (core ⇄ Prisma, giá trị y hệt)

```
CrmMessageKind     = SERVICE | MARKETING
CrmChannel         = IN_APP | EMAIL
CrmAutomationKind  = THANK_YOU | REVIEW_REQUEST | REORDER_REMINDER
CrmCampaignStatus  = DRAFT | SCHEDULED | SENDING | SENT | CANCELLED
CrmMessageStatus   = SCHEDULED | SENT | SKIPPED | FAILED
ConsentSource      = STOREFRONT | CHECKOUT | UNSUBSCRIBE_LINK
```

Chỉ ở core (không lưu thành cột enum): `CustomerSegment = NEW | RETURNING | VIP | AT_RISK | LAPSED`,
`CrmSkipReason = VENDOR_INACTIVE | AUTOMATION_DISABLED | NO_CONSENT | OPTED_OUT | FREQUENCY_CAP | ALREADY_REVIEWED | ALREADY_REORDERED | ORDER_REFUNDED | NO_CHANNEL | CAMPAIGN_CANCELLED`.

### 2.2 Mã lỗi (`ERROR_CODES` + HTTP + vi/en)

| Mã                                 | HTTP |
| ---------------------------------- | ---- |
| `crm.error.not-a-customer`         | 404  |
| `crm.error.note-not-found`         | 404  |
| `crm.error.campaign-not-found`     | 404  |
| `crm.error.campaign-not-editable`  | 409  |
| `crm.error.campaign-limit-reached` | 429  |
| `crm.error.coupon-invalid`         | 422  |
| `crm.error.links-not-allowed`      | 422  |
| `crm.error.unknown-placeholder`    | 422  |
| `crm.error.empty-audience`         | 422  |
| `crm.error.unsubscribe-invalid`    | 404  |
| `notification.error.not-found`     | 404  |

### 2.3 Id (brand ULID)

`VendorCustomerNoteId`, `CrmCampaignId`, `CrmMessageId`, `CrmAutomationId`, `NotificationId`.

### 2.4 Schema core — `packages/core/src/schemas/crm.ts` + `notification.ts`

Request (không bao giờ có `vendorId`/`userId` của người gọi):

| Schema                                                | Shape                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CrmTemplateTextSchema`                               | string trim 1–1000, qua `assertCrmTemplate` (C7: cấm link, placeholder hợp lệ)                                                                                                                                                                                                      |
| `CrmCustomerListQuerySchema`                          | `{ segment?: CustomerSegment, tag?: CrmTag, q?: string ≤ 100, productId?: ProductId, sort?: 'last_order' \| 'order_count', cursor?: string mờ (server mã hoá (khoá sắp xếp, customerId) để phân trang keyset ổn định), limit? }`                                                    |
| `ReplaceCustomerTagsSchema`                           | `{ tags: string[] }` — tối đa 10, mỗi tag trim 1–30, chữ thường, không trùng                                                                                                                                                                                                        |
| `CreateCustomerNoteSchema`                            | `{ body: string trim 1–2000 }`                                                                                                                                                                                                                                                      |
| `UpdateCrmAutomationSchema`                           | `{ isEnabled: boolean, delayDays: int, templateVi: CrmTemplateText \| null, templateEn: CrmTemplateText \| null, couponId: CouponId \| null }` — khoảng `delayDays` theo C8 kiểm ở server theo `kind` (lỗi `common.error.validation-failed`); `couponId` chỉ cho `REORDER_REMINDER` |
| `CrmAudienceFilterSchema`                             | `{ segments: CustomerSegment[] (0–5, không trùng), tags: string[] (0–10), boughtProductIds: ProductId[] (0–20), lastOrderWithinDays: int 1–730 \| null }` — mảng rỗng = không lọc theo tiêu chí đó                                                                                  |
| `CreateCrmCampaignSchema` / `UpdateCrmCampaignSchema` | `{ name: trim 1–120, audience: CrmAudienceFilter, templateVi: CrmTemplateText, templateEn: CrmTemplateText \| null, couponId: CouponId \| null }`                                                                                                                                   |
| `ScheduleCrmCampaignSchema`                           | `{ scheduledAt: iso datetime (offset ok) \| null }` — null = gửi ngay; ≤ 30 ngày tới                                                                                                                                                                                                |
| `CancelCrmCampaignSchema` (platform)                  | `{ reason: trim 3–500 }`                                                                                                                                                                                                                                                            |
| `UpdateVendorPreferenceSchema`                        | `{ marketingOptIn?: boolean, serviceOptOut?: boolean }` (ít nhất 1 trường)                                                                                                                                                                                                          |
| `UnsubscribeSchema`                                   | `{ token: string 43 ký tự base64url, scope: 'MARKETING' \| 'ALL' }`                                                                                                                                                                                                                 |

Read (nullability y DB, ngày giờ ISO, tiền là `Money`):

```
CrmCustomerSummary { customerId, name, avatarUrl|null, province|null, orderCount, firstOrderAt, lastOrderAt,
                     spend: Money[], segment, tags: string[], marketingOptIn: boolean }
CrmCustomerDetail  = Summary + { serviceOptOut: boolean,
                     recentOrders: { subOrderId, orderId, status, createdAt, total: Money, itemTitles: string[] }[] (≤ 20),
                     reviews: { productId, rating, body|null, createdAt }[] (≤ 20),
                     notes: { id, authorName, body, createdAt }[] (≤ 50, mới nhất trước) }
CrmSegmentCounts   { segments: { segment, customers, marketingOptedIn }[], totalCustomers }
CrmAutomation      { kind, messageKind, isEnabled, delayDays, templateVi|null, templateEn|null, couponId|null, updatedAt }
CrmCampaign        { id, name, status, audience, templateVi, templateEn|null, couponId|null, scheduledAt|null,
                     startedAt|null, completedAt|null, cancelledAt|null, recipientCount, createdAt,
                     stats: { sent, skipped, failed, couponRedemptions } }
CrmCampaignPreview { matchedCustomers, eligibleRecipients, sample: { vi: string, en: string } }
Notification       { id, vendorId|null, title, body, linkPath|null, readAt|null, createdAt }
VendorPreference   { vendorId, vendorName, marketingOptIn: boolean, serviceOptOut: boolean, updatedAt }
```

Hàm thuần (`packages/core/src/crm/`):

- `classifyCustomer({ orderCount, lastOrderAt }, now, thresholds): CustomerSegment` (C3).
- `assertCrmTemplate(text)` → ném `DomainError('crm.error.links-not-allowed' | 'crm.error.unknown-placeholder')`.
- `renderCrmTemplate(text, { customerName, shopName, couponCode? })` → string (placeholder `{couponCode}` khi không có coupon → chuỗi rỗng; không HTML).
- `messageKindOf(automationKind)` (C8).

### 2.5 Outbox event

Đã có sẵn từ T3.3 (`roadmap/integration`, `aggregateType = 'order'`) — CRM **dùng lại, không định nghĩa lại**:

```
'sub-order.delivered' { orderId, subOrderId, customerId }   // SHIPPED→DELIVERED
'sub-order.completed' { orderId, subOrderId, vendorId }     // khách xác nhận hoặc tự hoàn tất
```

Payload chỉ mang id: handler K5 đọc lại `vendorId`, `customerId`, `deliveredAt` / `completedAt` từ DB.

Mới (K1 thêm vào `OUTBOX_EVENT_SCHEMAS`, `aggregateType = 'crm-campaign'`):

```
'crm.campaign.scheduled' { campaignId, vendorId }
```

Handler cho cả ba nằm ở K5. Dispatcher `@workers/jobs` chỉ claim event có handler đã đăng ký (xác nhận của session roadmap 2026-11-23), nên event chưa có handler nằm chờ, không bị mất.

---

## 3. Task

| Task | Phạm vi                                               | Workspace                                            | Model                  | Phụ thuộc                                |
| ---- | ----------------------------------------------------- | ---------------------------------------------------- | ---------------------- | ---------------------------------------- |
| K1   | Core: enum, id, lỗi, schema, hàm thuần, outbox event  | `packages/core`                                      | sonnet                 | —                                        |
| K2   | DB: model, migration, seed demo                       | `packages/db`                                        | sonnet                 | —                                        |
| K3   | i18n: lỗi + template mặc định + chuỗi email/thông báo | `packages/i18n`                                      | haiku                  | K1                                       |
| K4a  | API CRM phía shop + platform                          | `server/src/crm`                                     | opus                   | K1, K2                                   |
| K4b  | API phía khách: thông báo, tuỳ chọn, huỷ đăng ký      | `server/src/notifications`, `server/src/crm-consent` | sonnet                 | K1, K2                                   |
| K5   | Worker CRM (lập lịch, gửi, kiểm lại điều kiện)        | `workers/jobs`                                       | opus                   | K1–K4, T2.2, T3.3 — **chưa làm đợt này** |
| K6   | Docs                                                  | `*.md`                                               | haiku                  | K1–K4                                    |
| R    | Review → sửa → commit                                 | —                                                    | lead + `code-reviewer` | —                                        |

Đợt: **1** = K1 ║ K2 → **2** = K3 ║ K4a ║ K4b → **3** = K6, R.

**Luật cho agent:** chỉ sửa workspace của mình (cần đổi chỗ khác → dừng, báo lại); không `pnpm install/add`; không commit; DB local cho CRM là `postgresql://postgres:postgres@localhost:5433/ecommerce_crm` (+ `ecommerce_crm_shadow`) — **truyền qua biến môi trường**, không sửa `.env`, không đụng DB cổng 5432; test tích hợp server dùng harness Testcontainers có sẵn. Báo cáo cuối: file đã đổi, lệnh đã chạy + kết quả thật (số test), lệch kế hoạch + lý do.

### K1 — Core · sonnet

- **Mục tiêu:** mọi shape §2.1–2.5 có trong core, đúng tên.
- **Việc:** enum (`src/enums`) cho 6 enum có trong Prisma; `CustomerSegment`, `CrmSkipReason` để ở `schemas/crm.ts` (không phải Prisma enum — kiểm `test/enums.test.ts`); id §2.3; lỗi §2.2; `schemas/crm.ts`, `schemas/notification.ts` (export ở `schemas/index.ts`); `src/crm/` (hàm thuần §2.4, thêm subpath export + entry tsup nếu package dùng subpath cho thư mục logic — làm giống `src/orders`/`src/pricing`); event §2.5 vào `schemas/outbox.ts`.
- **Test:** mỗi schema ≥ 1 hợp lệ + ≥ 1 không hợp lệ; `classifyCustomer` ở mọi biên (đúng 60/61 ngày, 180/181, 2 và 3 đơn); `assertCrmTemplate` bắt `https://x.vn`, `www.x.com`, `shop.vn/abc`, placeholder lạ `{phone}`, cho qua chữ thường có dấu chấm cuối câu; `renderCrmTemplate` thay đủ placeholder, không có coupon → rỗng.
- **Xong khi:** `pnpm --filter @repo/core typecheck test build` xanh (test enum mirror sẽ đỏ tới khi K2 xong — báo lại, không né).

### K2 — DB · sonnet

- **Model** (thêm back-relation cần thiết ở `User`, `Vendor`, `Coupon`, `SubOrder`):
  - `VendorCustomer` (`vendor_customers`): `vendorId`, `userId`, `tags String[] @default([])`, timestamps; `@@id([vendorId, userId])`; `@@index([tags], type: Gin)`.
  - `VendorCustomerNote` (`vendor_customer_notes`): `id`, `vendorId`, `userId`, `authorId`, `body`, `createdAt`, `deletedAt?`; `@@index([vendorId, userId, createdAt])`.
  - `CustomerVendorPreference` (`customer_vendor_preferences`): `userId`, `vendorId`, `marketingOptInAt?`, `marketingOptInSource ConsentSource?`, `marketingOptOutAt?`, `serviceOptOutAt?`, `unsubscribeTokenHash String @unique`, timestamps; `@@id([userId, vendorId])`; `@@index([vendorId])`.
  - `CrmAutomation` (`crm_automations`): `id`, `vendorId`, `kind CrmAutomationKind`, `isEnabled @default(false)`, `delayDays Int`, `templateVi?`, `templateEn?`, `couponId?`, timestamps; `@@unique([vendorId, kind])`.
  - `CrmCampaign` (`crm_campaigns`): `id`, `vendorId`, `name`, `status @default(DRAFT)`, `audience Json`, `templateVi`, `templateEn?`, `couponId?`, `scheduledAt?`, `startedAt?`, `completedAt?`, `cancelledAt?`, `cancelReason?`, `recipientCount Int @default(0)`, `createdById`, timestamps; `@@index([vendorId, status])`, `@@index([status, scheduledAt])`.
  - `CrmMessage` (`crm_messages`): `id`, `vendorId`, `userId`, `kind CrmMessageKind`, `automationKind CrmAutomationKind?`, `campaignId?`, `subOrderId?`, `channels CrmChannel[]`, `status @default(SCHEDULED)`, `skipReason String?`, `scheduledFor`, `sentAt?`, `notificationId?`, `attempts Int @default(0)`, `lastError?`, timestamps; `@@unique([campaignId, userId])`, `@@unique([automationKind, subOrderId])`, `@@index([status, scheduledFor])`, `@@index([vendorId, userId, sentAt])`.
  - `Notification` (`notifications`): `id`, `userId`, `vendorId?`, `title`, `body`, `linkPath?`, `readAt?`, `createdAt`; `@@index([userId, createdAt])`, `@@index([userId, readAt])`.
  - `PlatformSettings` += `crmAtRiskAfterDays 60`, `crmLapsedAfterDays 180`, `crmVipMinOrders 3`, `crmMaxCampaignsPerWeek 2`, `crmMaxMarketingPerCustomerPerWeek 2` (map snake_case).
  - `SubOrder` += `@@index([vendorId, status])`.
- **Migration** `add_vendor_crm`: `migrate dev --create-only` với DB CRM (biến môi trường), **xoá mọi câu DROP/ALTER đụng index/cột viết tay** (xem cảnh báo drift trong `packages/db/CLAUDE.md`), áp bằng `migrate:deploy`. Không bao giờ đồng ý reset.
- **Seed** (idempotent, id cố định `01SEED…`): khách demo đã mua của vendor A có vài sub-order hợp lệ ở các mốc thời gian khác nhau để đủ 5 phân khúc (nếu seed hiện có chưa có đơn, tạo Order + SubOrder + OrderItem tối thiểu, tiền khớp công thức D7); 1 preference opt-in marketing; 1 automation `THANK_YOU` bật.
- **Test:** seed idempotent (cập nhật số đếm), unique `(campaignId,userId)` và `(automationKind, subOrderId)`.
- **Xong khi:** `pnpm --filter @repo/db typecheck test build` xanh; SQL migration dán trong báo cáo.

### K3 — i18n · haiku

- `errors.ts`: 11 mã §2.2 (vi/en).
- Namespace `crm` (camelCase lá): `defaultTemplates.{thankYou,reviewRequest,reorderReminder}` (dùng `{customerName}`, `{shopName}`, `{couponCode}` — giống nhau ở vi/en), `notificationTitle.{thankYou,reviewRequest,reorderReminder,campaign}` (`{shopName}`), `email.{footerReason,unsubscribeMarketing,unsubscribeAll,viewShop,writeReview,useCoupon}`, `unsubscribe.{title,marketingDone,allDone,invalid}`, `preferences.{title,marketingOptIn,serviceOptOut}`.
- **Xong khi:** `pnpm --filter @repo/i18n typecheck test build` xanh.

### K4a — API CRM phía shop + platform · opus

- **Module** `server/src/crm/`: `crm.module.ts`, `crm-customers.repository.ts` (SQL tổng hợp tham số hoá — C1/C2/C3, phân trang cursor ổn định), `crm-customers.service.ts`, `crm-automations.service.ts`, `crm-campaigns.service.ts`, controller mỏng.
- **API** (vendor scope từ `req.user.vendorId` + re-check vendor ACTIVE; quyền theo C13):

| Method     | Path                                                 | Ghi chú                                                                                                                                                           |
| ---------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET        | `/v1/vendor/crm/customers`                           | `CrmCustomerListQuery` → `Page<CrmCustomerSummary>`                                                                                                               |
| GET        | `/v1/vendor/crm/customers/:customerId`               | `CrmCustomerDetail`; không phải khách → 404 `crm.error.not-a-customer`                                                                                            |
| PUT        | `/v1/vendor/crm/customers/:customerId/tags`          | upsert `VendorCustomer`                                                                                                                                           |
| POST       | `/v1/vendor/crm/customers/:customerId/notes`         | 201                                                                                                                                                               |
| DELETE     | `/v1/vendor/crm/customers/:customerId/notes/:noteId` | tác giả hoặc OWNER; soft delete                                                                                                                                   |
| GET        | `/v1/vendor/crm/segments`                            | `CrmSegmentCounts`                                                                                                                                                |
| GET        | `/v1/vendor/crm/automations`                         | đủ 3 loại (chưa có dòng → mặc định tắt)                                                                                                                           |
| PUT        | `/v1/vendor/crm/automations/:kind`                   | OWNER; kiểm `delayDays` theo C8, coupon theo C10                                                                                                                  |
| GET / POST | `/v1/vendor/crm/campaigns`                           | POST `@Idempotent()` tạo DRAFT                                                                                                                                    |
| GET / PUT  | `/v1/vendor/crm/campaigns/:id`                       | PUT chỉ DRAFT (`crm.error.campaign-not-editable`)                                                                                                                 |
| POST       | `/v1/vendor/crm/campaigns/:id/preview`               | `CrmCampaignPreview` (đếm + mẫu render vi/en với tên giả "Minh")                                                                                                  |
| POST       | `/v1/vendor/crm/campaigns/:id/schedule`              | OWNER, `@Idempotent()`; DRAFT → SCHEDULED; giới hạn C10; audience đủ điều kiện = 0 → `crm.error.empty-audience`; outbox `crm.campaign.scheduled` cùng transaction |
| POST       | `/v1/vendor/crm/campaigns/:id/cancel`                | OWNER; DRAFT/SCHEDULED → CANCELLED, dòng `crm_messages` SCHEDULED của chiến dịch → SKIPPED(`CAMPAIGN_CANCELLED`)                                                  |
| GET        | `/v1/platform/crm/campaigns?vendorId=&status=`       | PLATFORM_STAFF/ADMIN                                                                                                                                              |
| POST       | `/v1/platform/crm/campaigns/:id/cancel`              | PLATFORM_STAFF/ADMIN, body `CancelCrmCampaignSchema`                                                                                                              |

- **Service:** chuyển trạng thái chiến dịch bằng `updateMany where status = <from>` trong `$transaction`; không bao giờ trả email/phone (test kiểm JSON không chứa khoá `email`, `phone`); hàm `resolveAudience(vendorId, filter, now)` dùng lại trong preview và (sau này) K5 — đặt trong repository, nhận `Prisma.TransactionClient`.
- **Test tích hợp (harness có sẵn):** thống kê + phân khúc đúng trên dữ liệu dựng sẵn (đối chiếu `classifyCustomer`); REFUNDED/CANCELLED/AWAITING_PAYMENT không tính; khách của shop B không thấy ở shop A (404); không lộ email/phone; tag/ghi chú; STAFF không sửa automation/lên lịch (403); template có link → 422; coupon của shop khác/hết hạn → 422; giới hạn 2 chiến dịch/tuần → 429; preview chỉ đếm khách opt-in; schedule ghi outbox; huỷ; platform huỷ.

### K4b — API phía khách · sonnet

- **Module** `server/src/notifications/` (+ `server/src/crm-consent/` hoặc gộp — tự chọn, ghi rõ).
- **API:**

| Method | Path                                  | Quyền                   | Ghi chú                                                                                                                                                                   |
| ------ | ------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/me/notifications`                | signed-in               | cursor, mới nhất trước                                                                                                                                                    |
| GET    | `/v1/me/notifications/unread-count`   | signed-in               | `{ count }`                                                                                                                                                               |
| POST   | `/v1/me/notifications/:id/read`       | signed-in               | của người khác → 404 `notification.error.not-found`; idempotent                                                                                                           |
| POST   | `/v1/me/notifications/read-all`       | signed-in               | 204                                                                                                                                                                       |
| GET    | `/v1/me/vendor-preferences`           | signed-in               | các shop đã mua hoặc đã có preference                                                                                                                                     |
| PUT    | `/v1/me/vendor-preferences/:vendorId` | CUSTOMER                | opt-in ghi `marketingOptInAt=now, source=STOREFRONT`, xoá `marketingOptOutAt`; opt-out ghi `marketingOptOutAt`; tạo dòng + token lần đầu                                  |
| POST   | `/v1/crm/unsubscribe`                 | public, rate limit chặt | `UnsubscribeSchema`; token sai → 404 `crm.error.unsubscribe-invalid`; `MARKETING` → opt-out marketing; `ALL` → + `serviceOptOutAt`; idempotent; source `UNSUBSCRIBE_LINK` |

- **Service dùng chung:** `ensurePreference(tx, userId, vendorId)` tạo dòng preference khi chưa có, với `unsubscribeTokenHash = hashUnsubscribeToken(await deriveUnsubscribeToken(env.CRM_UNSUBSCRIBE_SECRET, userId, vendorId))` (C12). Mọi thay đổi đồng ý ghi thêm `crm_consent_events` trong cùng transaction. Env mới `CRM_UNSUBSCRIBE_SECRET` (≥ 32 ký tự) ở server (K5 dùng ở worker), thêm vào `.env.example`.
- **Test:** ownership thông báo, đếm chưa đọc, opt-in/opt-out ghi đúng thời điểm + nguồn, unsubscribe token sai/đúng/lặp, rate limit.

### K5 — Worker CRM (đợt sau, khi `@workers/jobs` + T3.3 vào integration) · opus

- Handler `sub-order.delivered` / `sub-order.completed` → tạo `crm_messages` SCHEDULED cho automation đang bật (unique `(automationKind, subOrderId)`), `scheduledFor = mốc + delayDays`.
  - **Mỗi event type chỉ có một handler** trong `@workers/jobs` (dispatcher đánh dấu processed sau handler). `sub-order.delivered` đã có handler gửi email "xác nhận đã nhận hàng" (T3.2, `c03544e`): K5 **mở rộng** handler đó thành fan-out các sub-handler chạy trong cùng transaction, không đăng ký handler thứ hai. `sub-order.completed` chưa có handler — các dòng outbox nằm chờ tới khi K5 đăng ký.
- Handler `crm.campaign.scheduled` + job lặp mỗi phút: chiến dịch SCHEDULED đến hạn → SENDING, `resolveAudience` lúc gửi, chèn `crm_messages` theo lô 500 (unique `(campaignId, userId)`), cập nhật `recipientCount`, xong → SENT.
- Job lặp mỗi phút `crm.dispatch-due-messages`: lấy ≤ 200 tin đến hạn `FOR UPDATE SKIP LOCKED`, kiểm lại C5/C8/C9/C11 → tạo `Notification` + email (template `@repo/i18n` theo `primaryLocale`, escape HTML, link huỷ đăng ký xoay token, `List-Unsubscribe`), `SENT`/`SKIPPED`/`FAILED` (+ `attempts`, `lastError`).
- Test: Testcontainers, transport email giả, mọi lý do SKIPPED, không gửi trùng khi 2 worker chạy song song.

### K6 — Docs · haiku

- `CLAUDE.md` gốc (§1 trạng thái, §11 entity: thêm khối CRM), `server/CLAUDE.md` (mục CRM + giới hạn quy mô C1 + quyết định token K4b), `packages/core/CLAUDE.md`, `packages/db/CLAUDE.md` (model/enum mới, migration), roadmap (Đợt 7 trỏ về file này — nếu lead chưa thêm).

### R — Review & commit (lead)

`code-reviewer` cho từng nhóm (core+db+i18n; server), xác minh, sửa lỗi thật; gate `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (DB CRM qua biến môi trường); commit Conventional Commits theo task; push + PR vào `roadmap/integration` khi người dùng yêu cầu.
