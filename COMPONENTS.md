# COMPONENTS.md — Inventory component (nguồn: Elma eCommerce UI Kit)

> Extract từ file .fig: **428 components**, kèm tần suất tái sử dụng thực tế trong kit (×N = số instance).
> Dùng kèm **DESIGN.md** (theme/tokens). File này trả lời: _cần build component nào, ưu tiên cái nào trước._

## Cách dùng

- Build theo tier: **P1** (≥20 lần dùng) → **P2** (5–19) → **P3** (1–4). Component "–" (0 lần) chỉ build khi page cần.
- Tick checkbox khi component đã code + đủ states + đạt checklist trong DESIGN.md.
- **Base Shape** (mục 6) là kỹ thuật lồng component của Figma — KHÔNG code riêng, nó chính là Button/Input primitive của bạn.
- **Icon**: không vẽ lại — dùng thư viện (lucide-react) map theo tên, hoặc export SVG từ Figma. **Logo**: asset SVG tĩnh.

## 0. Tổng quan

| Nhóm                          | SL  | Bản chất       | Hành động                                 |
| ----------------------------- | --- | -------------- | ----------------------------------------- |
| Buttons                       | 30  | atom           | Code thành `<Button>` 1 component + props |
| Forms                         | 24  | atom           | `<Input>`, `<Select>`, `<Checkbox>`...    |
| Navbar/Label/Pagination/Color | 8   | atom           | component nhỏ                             |
| Icon                          | 65  | asset          | lucide-react / SVG export                 |
| Logo                          | 42  | asset          | SVG tĩnh                                  |
| Base Shape                    | 36  | kỹ thuật Figma | KHÔNG code riêng                          |
| Parts (molecules)             | 97  | tổ hợp atoms   | code sau atoms                            |
| Elements (organisms)          | 102 | section UI     | code sau parts                            |
| Base Element (page sections)  | 24  | template lớn   | Navbar, Footer, Hero...                   |

## 1. Buttons (30) → gom thành 1 `<Button>` với props `variant × size × icon`

- [ ] **Primary/Large** — 80×48 — dùng ×22 (P1)
- [ ] **Primary/Regular** — 80×40 — dùng ×22 (P1)
- [ ] **Outline/Large** — 80×48 — dùng ×15 (P2)
- [ ] **Primary & Left Icon/Align Center/Large** — 120×48 — dùng ×14 (P2)
- [ ] **Outline/Regular** — 80×40 — dùng ×7 (P2)
- [ ] **Primary & Left Icon/Align Center/Regular** — 120×40 — dùng ×5 (P2)
- [ ] **Primary & Right Icon/Align Center/Large** — 120×48 — dùng ×5 (P2)
- [ ] **Primary & Right Icon/Align Left & Right/Large** — 120×48 — dùng ×4 (P3)
- [ ] **Outline & Left Icon/Align Center/Large** — 120×48 — dùng ×3 (P3)
- [ ] **Outline & Right Icon/Align Left & Right/Large** — 120×48 — dùng ×3 (P3)
- [ ] **Primary & Right Icon/Align Left & Right/Small** — 100×30 — dùng ×3 (P3)
- [ ] **Primary & Right Icon/Align Left & Right/Regular** — 120×40 — dùng ×1 (P3)
- [ ] **Outline & Left Icon/Align Center/Regular** — 120×40
- [ ] **Outline & Left Icon/Align Center/Small** — 100×30
- [ ] **Outline & Left Icon/Align Left & Right/Large** — 120×48
- [ ] **Outline & Left Icon/Align Left & Right/Regular** — 120×40
- [ ] **Outline & Left Icon/Align Left & Right/Small** — 100×30
- [ ] **Outline & Right Icon/Align Center/Large** — 120×48
- [ ] **Outline & Right Icon/Align Center/Regular** — 120×40
- [ ] **Outline & Right Icon/Align Center/Small** — 100×30
- [ ] **Outline & Right Icon/Align Left & Right/Regular** — 120×40
- [ ] **Outline & Right Icon/Align Left & Right/Small** — 100×30
- [ ] **Outline/Small** — 80×30
- [ ] **Primary & Left Icon/Align Center/Small** — 100×30
- [ ] **Primary & Left Icon/Align Left & Right/Large** — 120×48
- [ ] **Primary & Left Icon/Align Left & Right/Regular** — 120×40
- [ ] **Primary & Left Icon/Align Left & Right/Small** — 100×30
- [ ] **Primary & Right Icon/Align Center/Regular** — 120×40
- [ ] **Primary & Right Icon/Align Center/Small** — 100×30
- [ ] **Primary/Small** — 80×30

## 2. Forms (24)

- [ ] **Input/Normal/Large/Filled** — 300×48 — dùng ×25 (P1)
- [ ] **Input/Normal/Large/Blank** — 300×48 — dùng ×6 (P2)
- [ ] **Input/Right Icon/Large/Blank** — 300×48 — dùng ×4 (P3)
- [ ] **Input/Right Icon/Large/Filled** — 300×48 — dùng ×2 (P3)
- [ ] **Input/Right Icon/Medium/Blank** — 300×40 — dùng ×1 (P3)
- [ ] **Input/Left & Right Icon/Large/Blank** — 300×48
- [ ] **Input/Left & Right Icon/Large/Filled** — 300×48
- [ ] **Input/Left & Right Icon/Medium/Blank** — 300×40
- [ ] **Input/Left & Right Icon/Medium/Filled** — 300×40
- [ ] **Input/Left & Right Icon/Small/Blank** — 300×32
- [ ] **Input/Left & Right Icon/Small/Filled** — 300×32
- [ ] **Input/Left Icon/Large/Blank** — 300×48
- [ ] **Input/Left Icon/Large/Filled** — 300×48
- [ ] **Input/Left Icon/Medium/Blank** — 300×40
- [ ] **Input/Left Icon/Medium/Filled** — 300×40
- [ ] **Input/Left Icon/Small/Blank** — 300×32
- [ ] **Input/Left Icon/Small/Filled** — 300×32
- [ ] **Input/Normal/Medium/Blank** — 300×40
- [ ] **Input/Normal/Medium/Filled** — 300×40
- [ ] **Input/Normal/Small/Blank** — 300×32
- [ ] **Input/Normal/Small/Filled** — 300×32
- [ ] **Input/Right Icon/Medium/Filled** — 300×40
- [ ] **Input/Right Icon/Small/Blank** — 300×32
- [ ] **Input/Right Icon/Small/Filled** — 300×32

## 3. Atoms khác (8)

- [ ] **Navbar/Link/16/normal** — 45×20 — dùng ×139 (P1)
- [ ] **Navbar/Link/16/dropdown** — 92×20 — dùng ×34 (P1)
- [ ] **Label/Numbers** — 32×18 — dùng ×34 (P1)
- [ ] **Label/Notif** — 19×19 — dùng ×6 (P2)
- [ ] **Pagination/No Active** — 38×38 — dùng ×4 (P3)
- [ ] **Pagination/Next** — 38×38 — dùng ×3 (P3)
- [ ] **Pagination/Active** — 38×38 — dùng ×1 (P3)
- [ ] **Color/001** — 68×28 — dùng ×11 (P2)

## 4. Icons (65) — map sang icon library

**25**: Star (×171) · Chevron/Right (×70) · User (×51) · Love (×31) · Checkbox/Uncheck (×23) · Chevron/Down (×22) · Radio button/No Active (×16) · Checkbox/Check (×15) · Stroller (×14) · Radio button/Active (×13) · Search (×12) · Up & Down (×10) · Dollar · Shipping · Trash · Add · Phone · Phone · Arrow/Right · Edit · Home · Minus · Store · Archive · Chevron/Left · Message · Money · Camera · Card · Computer · Customer Service · Flash · Headphones · Mens fashion · Play · Thumb/Dislike · Thumb/Like · Arrow/Left · Badge · Chat · Close · Feature · Games · Healthy · Product · Success · Arrow/Down · Ball · Battery · Burger · Chevron/Up · Copy · Info · Microphone · Notification · Refresh · Report · Share · Shopping bag · View · View/Grid · View/List · Arrow/Up · Best Prices · Mouse

## 5. Logos (42) — assets

**Social Media**: Facebook · Twitter · Instagram · Linkedin · Github · YT · Google · Slack

**Marketplace**: Airbnb · CM · Google · Shopify · Amazon · Dropbox

**Brand**: Apple · Asus · Samsung · Xiaomi · Sony · Wacom · Barbour · Fila · Converse · Huawei · Ikea · Lenovo

**Payment**: Master Card · Paypal · Visa · American Express · Cirrus

**Language**: US · Germany · France · Spain

**Store**: App Store · Play Store

**Expedition**: DHL · Express · FedEx · JNE · POS

## 6. Base Shape (36) — KHÔNG code riêng

Đây là primitive nền (100×40, các mức radius 0/4/8/12/99 × kiểu fill/outline/fill-light) mà Figma dùng để lồng vào Buttons/Forms. Trong code, nó tương đương props `variant` + `radius` của Button/Input. Tần suất cao của nhóm này (×225, ×171...) xác nhận: hệ thống variant ở DESIGN.md mục 8 là xương sống của toàn kit.

## 7. Parts — molecules (97)

### Parts/Product (43)

- [ ] **3 item/Type 1/001** — 350×104 — dùng ×3 (P3)
- [ ] **3 item/Type 1/002** — 350×104 — dùng ×3 (P3)
- [ ] **3 item/Type 1/003** — 350×104 — dùng ×3 (P3)
- [ ] **4 item/Type 5/001** — 255×376 — dùng ×3 (P3)
- [ ] **4 item/Type 5/002** — 255×376 — dùng ×3 (P3)
- [ ] **4 item/Type 5/003** — 255×376 — dùng ×3 (P3)
- [ ] **4 item/Type 1/001** — 255×399 — dùng ×1 (P3)
- [ ] **4 item/Type 1/002** — 255×399 — dùng ×1 (P3)
- [ ] **4 item/Type 1/003** — 255×399 — dùng ×1 (P3)
- [ ] **4 item/Type 2/001** — 255×421 — dùng ×1 (P3)
- [ ] **4 item/Type 2/002** — 255×421 — dùng ×1 (P3)
- [ ] **4 item/Type 2/003** — 255×421 — dùng ×1 (P3)
- [ ] **4 item/Type 2/004** — 255×421 — dùng ×1 (P3)
- [ ] **4 item/Type 3/001** — 255×380 — dùng ×1 (P3)
- [ ] **4 item/Type 3/002** — 255×380 — dùng ×1 (P3)
- [ ] **4 item/Type 3/003** — 255×380 — dùng ×1 (P3)
- [ ] **4 item/Type 3/004** — 255×380 — dùng ×1 (P3)
- [ ] **4 item/Type 3/005** — 255×380 — dùng ×1 (P3)
- [ ] **4 item/Type 3/006** — 255×380 — dùng ×1 (P3)
- [ ] **4 item/Type 3/007** — 255×380 — dùng ×1 (P3)
- [ ] **4 item/Type 3/Active** — 255×489 — dùng ×1 (P3)
- [ ] **4 item/Type 4/001** — 255×380 — dùng ×1 (P3)
- [ ] **4 item/Type 4/002** — 256×380 — dùng ×1 (P3)
- [ ] **4 item/Type 4/003** — 256×380 — dùng ×1 (P3)
- [ ] **4 item/Type 4/004** — 256×380 — dùng ×1 (P3)
- [ ] **4 item/Type 6/001** — 255×360 — dùng ×1 (P3)
- [ ] **4 item/Type 6/002** — 255×360 — dùng ×1 (P3)
- [ ] **4 item/Type 6/003** — 255×360 — dùng ×1 (P3)
- [ ] **4 item/Type 6/Active** — 255×360 — dùng ×1 (P3)
- [ ] **6 item/Type 1/001** — 160×305 — dùng ×1 (P3)
- [ ] **6 item/Type 1/002** — 160×305 — dùng ×1 (P3)
- [ ] **6 item/Type 1/003** — 160×305 — dùng ×1 (P3)
- [ ] **6 item/Type 1/004** — 160×305 — dùng ×1 (P3)
- [ ] **6 item/Type 1/005** — 160×305 — dùng ×1 (P3)
- [ ] **6 item/Type 1/006** — 160×305 — dùng ×1 (P3)
- [ ] **3 item/Type 1/001** — 350×363
- [ ] **3 item/Type 1/002** — 350×429
- [ ] **3 item/Type 1/003** — 350×429
- [ ] **4 item/Banner/001** — 255×380
- [ ] **4 item/Banner/002** — 255×380
- [ ] **4 item/Banner/003** — 255×380
- [ ] **4 item/Type 3/008** — 255×380
- [ ] **4 item/Type 6/004** — 255×360

### Parts/Sign In & Register (10)

- [ ] **Benefit Item/002** — 235×158 — dùng ×4 (P3)
- [ ] **Benefit Item/001** — 540×104 — dùng ×3 (P3)
- [ ] **350px/Info/001** — 350×514 — dùng ×2 (P3)
- [ ] **350px/Info/002** — 350×660 — dùng ×2 (P3)
- [ ] **Benefit/540px/001** — 540×586 — dùng ×2 (P3)
- [ ] **Benefit/540px/002** — 540×560 — dùng ×2 (P3)
- [ ] **Register/001** — 540×660 — dùng ×2 (P3)
- [ ] **Register/002** — 540×650 — dùng ×2 (P3)
- [ ] **Sign In/001** — 540×514 — dùng ×2 (P3)
- [ ] **Sign In/002** — 540×511 — dùng ×2 (P3)

### Parts/Blog (7)

- [ ] **2 items/002** — 540×240 — dùng ×4 (P3)
- [ ] **3 items/001** — 350×386 — dùng ×3 (P3)
- [ ] **3 items/002** — 350×375 — dùng ×3 (P3)
- [ ] **3 items/003** — 350×306 — dùng ×3 (P3)
- [ ] **2 items/001** — 540×260 — dùng ×2 (P3)
- [ ] **2 items/003** — 540×240
- [ ] **3 items/004** — 350×328

### Parts/Checkout (7)

- [ ] **Checkout list/730px/001** — 730×720 — dùng ×4 (P3)
- [ ] **730px/Choose shipping** — 730×620 — dùng ×2 (P3)
- [ ] **730px/Order review final** — 730×610 — dùng ×2 (P3)
- [ ] **730px/Payment method** — 730×196 — dùng ×2 (P3)
- [ ] **730px/Shipping to..** — 730×306 — dùng ×2 (P3)
- [ ] **730px/Track Package** — 730×812 — dùng ×2 (P3)
- [ ] **Customer Receive/730px/001** — 730×426 — dùng ×1 (P3)

### Parts/Testi (6)

- [ ] **3 item/001** — 350×208 — dùng ×3 (P3)
- [ ] **3 item/002** — 350×266 — dùng ×3 (P3)
- [ ] **3 item/003** — 350×264 — dùng ×3 (P3)
- [ ] **2 item/001** — 540×213 — dùng ×2 (P3)
- [ ] **1 item/001** — 1110×300 — dùng ×1 (P3)
- [ ] **1 item/002** — 1110×340 — dùng ×1 (P3)

### Parts/Category Item (2)

- [ ] **001** — 160×220 — dùng ×6 (P2)
- [ ] **002** — 160×194 — dùng ×6 (P2)

### Parts/Additional (5)

- [ ] **Order Summary/002** — 350×796 — dùng ×4 (P3)
- [ ] **Apply Voucher/001** — 350×126 — dùng ×2 (P3)
- [ ] **Order Summary/001** — 350×465 — dùng ×2 (P3)
- [ ] **Order Summary/003** — 350×578 — dùng ×2 (P3)
- [ ] **Order Summary/004** — 350×733 — dùng ×2 (P3)

### Parts/Shopping cart (4)

- [ ] **Tab/01** — 1110×56 — dùng ×4 (P3)
- [ ] **item/Non active** — 98×56 — dùng ×2 (P3)
- [ ] **item/Finished** — 99×56 — dùng ×1 (P3)
- [ ] **item/selected** — 99×56 — dùng ×1 (P3)

### Parts/Shop Categories (6)

- [ ] **3 item/001** — 350×556 — dùng ×1 (P3)
- [ ] **3 item/002** — 350×556 — dùng ×1 (P3)
- [ ] **3 item/003** — 350×556 — dùng ×1 (P3)
- [ ] **3 item/004** — 350×556 — dùng ×1 (P3)
- [ ] **3 item/005** — 350×556 — dùng ×1 (P3)
- [ ] **3 item/006** — 350×556 — dùng ×1 (P3)

### Parts/Chekout (3)

- [ ] **Form/Add Customer data** — 730×552 — dùng ×2 (P3)
- [ ] **Form/Payment with/001** — 730×620 — dùng ×2 (P3)
- [ ] **Form/Payment with/002** — 730×624

### Parts/Product Featured (1)

- [ ] **4 item/001** — 255×340 — dùng ×2 (P3)

### Parts/Store Featured (2)

- [ ] **4 item/001** — 255×340 — dùng ×1 (P3)
- [ ] **4 item/002** — 255×340

### Parts/Badge (1)

- [ ] **4 item/Flash Sale** — 255×284

## 8. Elements — organisms (102)

### Elements/Tittle (4)

- [ ] **Shopping cart/001** — 1440×168 — dùng ×2 (P3)
- [ ] **Shopping cart/002** — 1440×132 — dùng ×2 (P3)
- [ ] **Order Tracking/001** — 1440×138 — dùng ×1 (P3)
- [ ] **Search result/001** — 1440×198 — dùng ×1 (P3)

### Elements/Brand Logo (7)

- [ ] **Full width/6 Brand with text** — 1440×274 — dùng ×2 (P3)
- [ ] **Full width/10 Brand box** — 1440×638 — dùng ×1 (P3)
- [ ] **Full width/6 Brand** — 1440×121 — dùng ×1 (P3)
- [ ] **1110px/10 Brand** — 1110×240
- [ ] **1110px/4 Brand** — 1110×120
- [ ] **1110px/5 Brand** — 1110×120
- [ ] **1110px/6 Brand** — 1110×120

### Elements/Filter (14)

- [ ] **4 item/011** — 255×328 — dùng ×1 (P3)
- [ ] **4 item/012** — 255×270 — dùng ×1 (P3)
- [ ] **4 item/013** — 255×156 — dùng ×1 (P3)
- [ ] **4 item/Full** — 256×1140 — dùng ×1 (P3)
- [ ] **4 item/001** — 255×212
- [ ] **4 item/002** — 255×212
- [ ] **4 item/003** — 255×212
- [ ] **4 item/004** — 255×212
- [ ] **4 item/005** — 255×212
- [ ] **4 item/006** — 255×282
- [ ] **4 item/007** — 255×102
- [ ] **4 item/008** — 255×174
- [ ] **4 item/009** — 255×236
- [ ] **4 item/010** — 255×270

### Elements/Related Products (2)

- [ ] **4 item/001** — 1440×516 — dùng ×1 (P3)
- [ ] **6 item/001** — 1440×481 — dùng ×1 (P3)

### Elements/Banner (28)

- [ ] **1110px/006** — 1110×353 — dùng ×1 (P3)
- [ ] **1110px/001** — 1110×380
- [ ] **1110px/002** — 1110×340
- [ ] **1110px/003** — 1110×400
- [ ] **1110px/004** — 1110×400
- [ ] **1110px/005** — 1110×350
- [ ] **350px/Landscape/001** — 350×162
- [ ] **350px/Landscape/002** — 350×162
- [ ] **350px/Landscape/003** — 350×162
- [ ] **350px/Potrait/001** — 350×370
- [ ] **350px/Potrait/002** — 350×370
- [ ] **350px/Potrait/003** — 350×370
- [ ] **540px/001** — 540×220
- [ ] **540px/002** — 540×220
- [ ] **540px/003** — 540×200
- [ ] **540px/004** — 540×200
- [ ] **540px/005** — 540×200
- [ ] **730px/001** — 730×280
- [ ] **730px/002** — 730×280
- [ ] **730px/003** — 730×290
- [ ] **825px/001** — 825×340
- [ ] **825px/002** — 825×297
- [ ] **825px/003** — 825×300
- [ ] **Full Width/001** — 1440×300
- [ ] **Full Width/002** — 1440×350
- [ ] **Full Width/003** — 1440×350
- [ ] **Full Width/004** — 1440×350
- [ ] **Full Width/005** — 1440×310

### Elements/Benefit (2)

- [ ] **001** — 1440×124 — dùng ×1 (P3)
- [ ] **002** — 1440×154

### Elements/Best Seller Product (2)

- [ ] **001** — 1440×1080 — dùng ×1 (P3)
- [ ] **002** — 1440×670

### Elements/Blog (6)

- [ ] **001** — 1440×598 — dùng ×1 (P3)
- [ ] **002** — 1440×656
- [ ] **003** — 1440×645
- [ ] **004** — 1440×664
- [ ] **005** — 1440×530
- [ ] **006** — 1440×780

### Elements/Category (2)

- [ ] **001** — 1440×397 — dùng ×1 (P3)
- [ ] **002** — 1440×371

### Elements/Content result grid (1)

- [ ] **001** — 1440×1946 — dùng ×1 (P3)

### Elements/Description (1)

- [ ] **001** — 1440×594 — dùng ×1 (P3)

### Elements/Header (5)

- [ ] **001** — 1440×686 — dùng ×1 (P3)
- [ ] **002** — 1440×900
- [ ] **003** — 1440×887
- [ ] **004** — 1440×907
- [ ] **005** — 1440×676

### Elements/Order Success (2)

- [ ] **001** — 1440×456 — dùng ×1 (P3)
- [ ] **002** — 1440×456

### Elements/Product Card details (2)

- [ ] **001** — 1440×623 — dùng ×1 (P3)
- [ ] **002** — 1440×575

### Elements/Product List (1)

- [ ] **001** — 1440×570 — dùng ×1 (P3)

### Elements/Review (1)

- [ ] **001** — 1440×1212 — dùng ×1 (P3)

### Elements/Shop Categories (1)

- [ ] **001** — 1440×1433 — dùng ×1 (P3)

### Elements/Download Apps (5)

- [ ] **001** — 1440×232
- [ ] **002** — 1440×232
- [ ] **003** — 1440×232
- [ ] **004** — 1440×232
- [ ] **005** — 1110×362

### Elements/Flash Sale (2)

- [ ] **001** — 1440×559
- [ ] **002** — 1440×637

### Elements/Register (2)

- [ ] **001** — 1440×780
- [ ] **002** — 1440×770

### Elements/Shopping Cart (5)

- [ ] **001** — 1440×791
- [ ] **002** — 1440×1048
- [ ] **003** — 1440×1317
- [ ] **004** — 1440×1212
- [ ] **005** — 1440×852

### Elements/Sign In (2)

- [ ] **001** — 1440×634
- [ ] **002** — 1440×660

### Elements/Testimonial (5)

- [ ] **001** — 1440×477
- [ ] **002** — 1440×455
- [ ] **003** — 1440×860
- [ ] **004** — 1440×460
- [ ] **005** — 1440×522

## 9. Base Element — page sections (24)

- [ ] **Footer/001** — 1440×500 — dùng ×14 (P2)
- [ ] **Navbar/003** — 1440×140 — dùng ×14 (P2)
- [ ] **Footer/002** — 1440×748
- [ ] **Footer/003** — 1440×794
- [ ] **Footer/004** — 1440×560
- [ ] **Footer/005** — 1440×360
- [ ] **Footer/006** — 1440×600
- [ ] **Footer/007** — 1440×592
- [ ] **Footer/008** — 1440×592
- [ ] **Footer/009** — 1440×1041
- [ ] **Footer/010** — 1440×530
- [ ] **Menu Block/001** — 1440×888
- [ ] **Menu Block/002** — 1440×548
- [ ] **Menu Block/003** — 1440×503
- [ ] **Menu Block/004** — 1440×565
- [ ] **Navbar/001** — 1440×80
- [ ] **Navbar/002** — 1440×80
- [ ] **Navbar/004** — 1440×154
- [ ] **Navbar/005** — 1440×140
- [ ] **Navbar/006** — 1440×203
- [ ] **Navbar/007** — 1440×175
- [ ] **Navbar/008** — 1440×148
- [ ] **Navbar/009** — 1440×105
- [ ] **Navbar/010** — 1440×168

## 10. Thứ tự build đề xuất (P1 thực chiến)

1. Navbar/Link/16/normal (×139)
2. Label/Numbers (×34)
3. Navbar/Link/16/dropdown (×34)
4. Forms/Input/Normal/Large/Filled (×25)
5. Buttons/Primary/Large (×22)
6. Buttons/Primary/Regular (×22)
7. Buttons/Outline/Large (×15)
8. Base Element/Footer/001 (×14)
9. Base Element/Navbar/003 (×14)
10. Buttons/Primary & Left Icon/Align Center/Large (×14)

Sau đó: theo tier P2 → P3 trong từng mục, atoms trước → parts → elements → base elements.
