# SCREENS.md — Cấu trúc 14 màn hình (nguồn: Elma eCommerce UI Kit)

> Extract từ page "⎙ Design" của file .fig. Mỗi màn hình liệt kê **sections theo thứ tự dọc** (trên → xuống) kèm component sử dụng (khớp tên trong COMPONENTS.md) và heading text gốc để nhận diện.
> Dùng kèm: **DESIGN.md** (tokens) + **COMPONENTS.md** (inventory). Khi code 1 page: mở mục tương ứng dưới đây làm spec lắp ráp.

## Flow tổng thể

Home (001) → Shop Categories (002) → Search Result (003) → Product Details (004) → Cart (005) → Checkout: Info (006) → Shipping & Payment (007) → Review (008) → Order Success (009) → Track Order (010). Auth: Register (011 + Alt) · Sign In (012 + Alt).

Tất cả màn hình: **desktop 1440px**. Mobile không có trong kit → tự suy theo DESIGN.md quy tắc 9.

## Danh sách

| #   | Màn hình                      | Kích thước | Sections |
| --- | ----------------------------- | ---------- | -------- |
| 001 | Homepage - with Symbol        | 1440×4701  | 10       |
| 002 | Shop Categories               | 1440×2711  | 4        |
| 003 | Search result - Grid          | 1440×2784  | 4        |
| 004 | Product Details               | 1440×3625  | 6        |
| 005 | Shopping Cart                 | 1440×2212  | 10       |
| 006 | Checkout - Customer Info      | 1440×2212  | 10       |
| 007 | Checkout - Shipping & Payment | 1440×2241  | 10       |
| 008 | Checkout - Review order       | 1440×2146  | 11       |
| 009 | Order success                 | 1440×1256  | 3        |
| 010 | Track Order                   | 1440×1694  | 5        |
| 011 | Register                      | 1440×1444  | 5        |
| 011 | Register Alt                  | 1440×1688  | 5        |
| 012 | Sign In                       | 1440×1298  | 5        |
| 011 | Sign In Alt                   | 1440×1578  | 5        |
| 013 | Live list (`/live`)           | ngoài kit  | 3        |
| 014 | Live watch (`/live/[id]`)     | ngoài kit  | 5        |

---

### 001 Homepage - with Symbol — 1440×4701

1. **Elements/Header/001** (686px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Elements/Header/001` · `Buttons/Primary/Large` — _"Best in Hi-Res and Noise Cancelling" / "Elma"_
2. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
3. **Elements/Benefit/001** (124px) — `Elements/Benefit/001` — _"Free Shipping" / "Money Guarantee"_
4. **Elements/Best Seller Product/001** (1080px) — `Buttons/Primary & Left Icon/Align Center/Regular ×2` · `Elements/Best Seller Product/001` · `Parts/Product/4 item/Type 3/001` · `Parts/Product/4 item/Type 3/002` — _"Best Seller Products" / "Apple Watch 4 2020"_
5. **Elements/Banner/1110px/006** (353px) — `Elements/Banner/1110px/006` · `Buttons/Primary/Large` — _"Lenovo Yoga X" / "$1500,00"_
6. **Elements/Category/001** (397px) — `Parts/Category Item/001 ×6` · `Elements/Category/001` · `Buttons/Outline/Large` — _"Category" / "Button"_
7. **Elements/Product List/001** (570px) — `Parts/Product/3 item/Type 1/001 ×3` · `Buttons/Outline & Right Icon/Align Left & Right/Large ×3` · `Parts/Product/3 item/Type 1/002 ×3` · `Parts/Product/3 item/Type 1/003 ×3` — _"Product list 1" / "Product list 2"_
8. **Elements/Blog/001** (598px) — `Elements/Blog/001` · `Buttons/Outline/Large` — _"Read our blog" / "Types of Blouse In Catalog fashion"_
9. **Elements/Brand Logo/Full width/6 Brand** (121px) — `Elements/Brand Logo/Full width/6 Brand`
10. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×10 · Parts/Category Item/001 ×6 · Navbar/Link/16/dropdown ×4 · Buttons/Outline/Large ×3 · Parts/Product/3 item/Type 1/001 ×3 · Buttons/Outline & Right Icon/Align Left & Right/Large ×3 · Parts/Product/3 item/Type 1/002 ×3 · Parts/Product/3 item/Type 1/003 ×3

### 002 Shop Categories — 1440×2711

1. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
2. **Elements/Shop Categories/001** (1433px) — `Elements/Shop Categories/001` · `Parts/Shop Categories/3 item/001` · `Parts/Shop Categories/3 item/004` · `Parts/Shop Categories/3 item/002` — _"Shop categories" / "Product list 1"_
3. **Elements/Brand Logo/Full width/10 Brand box** (638px) — `Elements/Brand Logo/Full width/10 Brand box` — _"Popular Brands" / "Check our best seller products on Elma website right now"_
4. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Navbar/Link/16/dropdown ×2 · Elements/Shop Categories/001 · Parts/Shop Categories/3 item/001 · Parts/Shop Categories/3 item/004 · Parts/Shop Categories/3 item/002 · Parts/Shop Categories/3 item/005 · Parts/Shop Categories/3 item/003

### 003 Search result - Grid — 1440×2784

1. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
2. **Elements/Tittle/Search result/001** (198px) — `Elements/Tittle/Search result/001` — _"Search result for ‘Macbook Pro’" / "Home"_
3. **Elements/Content result grid/001** (1946px) — `Pagination/No Active ×4` · `Parts/Product/4 item/Type 5/001 ×3` · `Parts/Product/4 item/Type 5/002 ×3` · `Parts/Product/4 item/Type 5/003 ×3` — _"Filter Options" / "Apple Store Official"_
4. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Pagination/No Active ×4 · Parts/Product/4 item/Type 5/001 ×3 · Parts/Product/4 item/Type 5/002 ×3 · Parts/Product/4 item/Type 5/003 ×3 · Parts/Product Featured/4 item/001 ×2 · Navbar/Link/16/dropdown ×2 · Elements/Tittle/Search result/001

### 004 Product Details — 1440×3625

1. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
2. **Elements/Product Card details/001** (623px) — `Elements/Product Card details/001` · `Buttons/Outline/Large` · `Buttons/Primary & Right Icon/Align Left & Right/Large` · `Buttons/Primary/Regular` — _"Sony Alpha Mirrorless 4K Video Camera (Body Only)" / "$1,999.99"_
3. **Elements/Description/001** (594px) — `Elements/Description/001` — _"Overview" / "What’s inside box ?"_
4. **Elements/Review/001** (1212px) — `Forms/Input/Normal/Large/Blank ×2` · `Elements/Review/001` · `Buttons/Primary & Right Icon/Align Left & Right/Regular` · `Buttons/Primary/Large` — _"4,6" / "/5.0"_
5. **Elements/Related Products/4 item/001** (516px) — `Elements/Related Products/4 item/001` · `Parts/Product/4 item/Type 6/Active` · `Parts/Product/4 item/Type 6/001` · `Parts/Product/4 item/Type 6/003` — _"Realated Products" / "Airpods 2nd Gen"_
6. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Buttons/Outline/Large ×2 · Forms/Input/Normal/Large/Blank ×2 · Navbar/Link/16/dropdown ×2 · Elements/Product Card details/001 · Buttons/Primary & Right Icon/Align Left & Right/Large · Buttons/Primary/Regular · Elements/Description/001

### 005 Shopping Cart — 1440×2212

1. **Base Shape/Shape/Fill/0 R** (480px)
2. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
3. **Elements/Tittle/Shopping cart/001** (168px) — `Elements/Tittle/Shopping cart/001` · `Buttons/Outline & Left Icon/Align Center/Large` — _"Shopping Cart" / "Button"_
4. **Parts/Shopping cart/Tab/01** (56px) — `Label/Notif ×2` · `Parts/Shopping cart/item/Non active ×2` · `Parts/Shopping cart/Tab/01` · `Parts/Shopping cart/item/Finished` — _"Cart" / "Cart"_
5. **Parts/Additional/Apply Voucher/001** (126px) — `Parts/Additional/Apply Voucher/001` — _"Have a voucher?" / "Apply"_
6. **Parts/Checkout/Checkout list/730px/001** (720px) — `Parts/Checkout/Checkout list/730px/001` — _"Beats by Dre C 3450" / "Women Yellow Turtleneck"_
7. **Parts/Checkout/Checkout list/730px/001** (720px) — `Parts/Checkout/Checkout list/730px/001` — _"Beats by Dre C 3450" / "Women Yellow Turtleneck"_
8. **Parts/Additional/Order Summary/001** (465px) — `Parts/Additional/Order Summary/001` · `Forms/Input/Normal/Large/Blank` — _"Text" / "Order Summary"_
9. **Elements/Related Products/6 item/001** (481px) — `Buttons/Outline/Regular ×6` · `Elements/Related Products/6 item/001` · `Buttons/Outline/Large` · `Parts/Product/6 item/Type 1/001` — _"Maybe you like it too…" / "Button"_
10. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Buttons/Outline/Regular ×6 · Label/Notif ×3 · Parts/Checkout/Checkout list/730px/001 ×2 · Navbar/Link/16/dropdown ×2 · Parts/Shopping cart/item/Non active ×2 · Parts/Additional/Apply Voucher/001 · Parts/Additional/Order Summary/001

### 006 Checkout - Customer Info — 1440×2212

1. **Base Shape/Shape/Fill/0 R** (480px)
2. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
3. **Elements/Tittle/Shopping cart/001** (168px) — `Elements/Tittle/Shopping cart/001` · `Buttons/Outline & Left Icon/Align Center/Large` — _"Shopping Cart" / "Button"_
4. **Parts/Shopping cart/Tab/01** (56px) — `Label/Notif ×2` · `Parts/Shopping cart/item/Non active ×2` · `Parts/Shopping cart/Tab/01` · `Parts/Shopping cart/item/Finished` — _"Cart" / "Cart"_
5. **Parts/Additional/Order Summary/002** (796px) — `Parts/Additional/Order Summary/002` — _"Beats by Dre C 3450" / "Macbook Pro 2018"_
6. **Parts/Checkout/Checkout list/730px/001** (720px) — `Parts/Checkout/Checkout list/730px/001` — _"Beats by Dre C 3450" / "Women Yellow Turtleneck"_
7. **Parts/Chekout/Form/Add Customer data** (552px) — `Forms/Input/Normal/Large/Filled ×6` · `Parts/Chekout/Form/Add Customer data` — _"Add Customer data" / "Text"_
8. **Buttons/Primary & Left Icon/Align Center/Large** (48px) — `Buttons/Primary & Left Icon/Align Center/Large` — _"Button"_
9. **Buttons/Primary & Left Icon/Align Center/Large** (48px) — `Buttons/Primary & Left Icon/Align Center/Large` — _"Button"_
10. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Forms/Input/Normal/Large/Filled ×6 · Label/Notif ×3 · Navbar/Link/16/dropdown ×2 · Parts/Shopping cart/item/Non active ×2 · Buttons/Primary & Left Icon/Align Center/Large ×2 · Parts/Chekout/Form/Add Customer data · Base Element/Navbar/003

### 007 Checkout - Shipping & Payment — 1440×2241

1. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
2. **Elements/Tittle/Shopping cart/002** (132px) — `Elements/Tittle/Shopping cart/002` · `Buttons/Outline & Left Icon/Align Center/Large` — _"Shipping & Payment" / "Button"_
3. **Base Shape/Shape/Fill/0 R** (480px)
4. **Parts/Shopping cart/Tab/01** (56px) — `Label/Notif ×2` · `Parts/Shopping cart/item/Non active ×2` · `Parts/Shopping cart/Tab/01` · `Parts/Shopping cart/item/Finished` — _"Cart" / "Cart"_
5. **Parts/Checkout/730px/Choose shipping** (620px) — `Parts/Checkout/730px/Choose shipping` — _"Choose Shipping Service" / "FedEx"_
6. **Parts/Additional/Order Summary/002** (791px) — `Parts/Additional/Order Summary/002` — _"Beats by Dre C 3450" / "Macbook Pro 2018"_
7. **Parts/Chekout/Form/Payment with/001** (617px) — `Forms/Input/Normal/Large/Filled ×2` · `Forms/Input/Right Icon/Large/Blank ×2` · `Parts/Chekout/Form/Payment with/001` · `Forms/Input/Normal/Large/Blank` — _"Payment with.." / "Text"_
8. **Buttons/Primary & Left Icon/Align Center/Large** (48px) — `Buttons/Primary & Left Icon/Align Center/Large` — _"Button"_
9. **Buttons/Primary & Left Icon/Align Center/Large** (48px) — `Buttons/Primary & Left Icon/Align Center/Large` — _"Button"_
10. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Label/Notif ×3 · Forms/Input/Normal/Large/Filled ×2 · Forms/Input/Right Icon/Large/Blank ×2 · Buttons/Primary & Left Icon/Align Center/Large ×2 · Parts/Shopping cart/item/Non active ×2 · Navbar/Link/16/dropdown ×2 · Parts/Checkout/730px/Choose shipping

### 008 Checkout - Review order — 1440×2146

1. **Base Shape/Shape/Fill/0 R** (480px)
2. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
3. **Elements/Tittle/Shopping cart/002** (132px) — `Elements/Tittle/Shopping cart/002` · `Buttons/Outline & Left Icon/Align Center/Large` — _"Shipping & Payment" / "Button"_
4. **Parts/Shopping cart/Tab/01** (56px) — `Label/Notif ×2` · `Parts/Shopping cart/item/Non active ×2` · `Parts/Shopping cart/Tab/01` · `Parts/Shopping cart/item/Finished` — _"Cart" / "Cart"_
5. **Parts/Additional/Order Summary/003** (578px) — `Parts/Additional/Order Summary/003` · `Forms/Input/Normal/Large/Blank` — _"Order Total" / "$1,610.00"_
6. **Parts/Checkout/730px/Shipping to..** (306px) — `Parts/Checkout/730px/Shipping to..` — _"Shipping to…" / "Gareth Barry"_
7. **Parts/Checkout/730px/Payment method** (196px) — `Parts/Checkout/730px/Payment method` — _"Payment method" / "Credit Card"_
8. **Parts/Checkout/730px/Order review final** (610px) — `Parts/Checkout/730px/Order review final` — _"Items cart" / "Beats by Dre C 3450"_
9. **Buttons/Primary & Left Icon/Align Center/Large** (48px) — `Buttons/Primary & Left Icon/Align Center/Large` — _"Button"_
10. **Buttons/Primary & Left Icon/Align Center/Large** (48px) — `Buttons/Primary & Left Icon/Align Center/Large` — _"Button"_
11. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Label/Notif ×3 · Buttons/Primary & Left Icon/Align Center/Large ×2 · Navbar/Link/16/dropdown ×2 · Parts/Shopping cart/item/Non active ×2 · Parts/Additional/Order Summary/003 · Forms/Input/Normal/Large/Blank · Parts/Checkout/730px/Shipping to..

### 009 Order success — 1440×1256

1. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
2. **Elements/Order Success/001** (456px) — `Elements/Order Success/001` — _"Purchase Success!" / "Track your order"_
3. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Navbar/Link/16/dropdown ×2 · Elements/Order Success/001 · Base Element/Navbar/003 · Label/Notif · Base Element/Footer/001

### 010 Track Order — 1440×1694

1. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
2. **Elements/Tittle/Order Tracking/001** (138px) — `Elements/Tittle/Order Tracking/001` · `Buttons/Outline & Left Icon/Align Center/Large` — _"Order tracking" / "Button"_
3. **Parts/Checkout/730px/Track Package** (812px) — `Parts/Checkout/730px/Track Package` · `Buttons/Primary & Left Icon/Align Center/Regular` — _"Your package in.." / "Button"_
4. **Parts/Additional/Order Summary/004** (733px) — `Parts/Additional/Order Summary/004` · `Forms/Input/Normal/Large/Filled` — _"Text" / "Beats by Dre C 3450"_
5. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Navbar/Link/16/dropdown ×2 · Base Element/Navbar/003 · Label/Notif · Elements/Tittle/Order Tracking/001 · Buttons/Outline & Left Icon/Align Center/Large · Parts/Checkout/730px/Track Package · Buttons/Primary & Left Icon/Align Center/Regular

### 011 Register — 1440×1444

1. **Base Shape/Shape/Fill/0 R** (480px)
2. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
3. **Parts/Sign In & Register/Register/001** (660px) — `Forms/Input/Normal/Large/Filled ×4` · `Parts/Sign In & Register/Register/001` · `Buttons/Primary/Large` · `Label/Numbers` — _"Register to Elma" / "Text"_
4. **Parts/Sign In & Register/350px/Info/002** (660px) — `Parts/Sign In & Register/350px/Info/002` — _"Discount 25% for New Member" / "Register now and subscribe our Newsletter to get and claim the 25% dis"_
5. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Forms/Input/Normal/Large/Filled ×4 · Navbar/Link/16/dropdown ×2 · Parts/Sign In & Register/Register/001 · Buttons/Primary/Large · Label/Numbers · Buttons/Primary & Left Icon/Align Center/Large · Parts/Sign In & Register/350px/Info/002

### 011 Register Alt — 1440×1688

1. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
2. **Parts/Sign In & Register/Benefit/540px/001** (586px) — `Parts/Sign In & Register/Benefit Item/001 ×3` · `Parts/Sign In & Register/Benefit/540px/001` — _"Join with +2 Million seller who offer best product from all across cou" / "Free Shipping"_
3. **Parts/Sign In & Register/Register/002** (650px) — `Forms/Input/Normal/Large/Filled ×5` · `Parts/Sign In & Register/Register/002` · `Forms/Input/Right Icon/Large/Filled` — _"New Member on here?" / "Text"_
4. **Elements/Brand Logo/Full width/6 Brand with text** (274px) — `Elements/Brand Logo/Full width/6 Brand with text` — _"Trusted by leading brand in the world"_
5. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Forms/Input/Normal/Large/Filled ×5 · Parts/Sign In & Register/Benefit Item/001 ×3 · Navbar/Link/16/dropdown ×2 · Elements/Brand Logo/Full width/6 Brand with text · Base Element/Navbar/003 · Label/Notif · Parts/Sign In & Register/Benefit/540px/001

### 012 Sign In — 1440×1298

1. **Base Shape/Shape/Fill/0 R** (480px)
2. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
3. **Parts/Sign In & Register/Sign In/001** (514px) — `Forms/Input/Normal/Large/Filled ×2` · `Parts/Sign In & Register/Sign In/001` · `Buttons/Primary/Large` · `Label/Numbers` — _"Sign in to Elma" / "Text"_
4. **Parts/Sign In & Register/350px/Info/001** (514px) — `Parts/Sign In & Register/350px/Info/001` — _"Crazy deals 7.7.7 Free Shipping All!" / "Register now and subscribe our Newsletter to get and claim the 25% dis"_
5. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Navbar/Link/16/dropdown ×2 · Forms/Input/Normal/Large/Filled ×2 · Base Element/Navbar/003 · Label/Notif · Parts/Sign In & Register/Sign In/001 · Buttons/Primary/Large · Label/Numbers

### 011 Sign In Alt — 1440×1578

1. **Base Element/Navbar/003** (140px) — `Navbar/Link/16/normal ×3` · `Navbar/Link/16/dropdown ×2` · `Base Element/Navbar/003` · `Label/Notif` — _"Elma" / "Text Link"_
2. **Parts/Sign In & Register/Sign In/002** (510px) — `Forms/Input/Normal/Large/Filled ×2` · `Parts/Sign In & Register/Sign In/002` — _"Welcome back" / "Text"_
3. **Parts/Sign In & Register/Benefit/540px/002** (560px) — `Parts/Sign In & Register/Benefit Item/002 ×4` · `Parts/Sign In & Register/Benefit/540px/002` — _"Enjoy all big benefits fro Elma that you can’t find in other product a" / "Free Shipping"_
4. **Elements/Brand Logo/Full width/6 Brand with text** (274px) — `Elements/Brand Logo/Full width/6 Brand with text` — _"Trusted by leading brand in the world"_
5. **Base Element/Footer/001** (500px) — `Navbar/Link/16/normal ×4` · `Base Element/Footer/001` — _"Elma" / "Home"_

Component chính: Navbar/Link/16/normal ×7 · Parts/Sign In & Register/Benefit Item/002 ×4 · Navbar/Link/16/dropdown ×2 · Forms/Input/Normal/Large/Filled ×2 · Base Element/Navbar/003 · Label/Notif · Base Element/Footer/001 · Elements/Brand Logo/Full width/6 Brand with text

### 013 Live list (`/live`) — ngoài kit

1. **Base Element/Navbar/003** — shared navbar
2. **Live tabs + cards** — tabs _Live now_ / _Upcoming_ / _Replays_; card: thumbnail, LIVE badge + viewer count (LIVE), scheduled time (SCHEDULED), replay duration (ENDED)
3. **Base Element/Footer/001** — shared footer

### 014 Live watch (`/live/[id]`) — ngoài kit

1. **Base Element/Navbar/003** — shared navbar
2. **Player** — Cloudflare Stream iframe; LIVE badge + viewer count; states: LIVE · SCHEDULED (not started) · ENDED with replay · ENDED replay processing
3. **Pinned product card** — add-to-cart; **Products drawer** lists the session's products
4. **Chat** — message list + composer; sign-in prompt replaces composer when signed out; heart reactions
5. **Base Element/Footer/001** — shared footer

Layout: mobile — video full width, chat list overlaid on the video, composer below the video; desktop — video + 360px side panel (chat, pinned product).

## Ghi chú khi code

- Chiều cao section là số đo design gốc — code dùng spacing tokens, không hardcode px chiều cao.
- Section trùng lặp giữa các màn (Navbar 003, Footer 001, Benefit 001) → build 1 lần, tái sử dụng layout chung.
- Heading text trong kit là placeholder tiếng Anh — thay bằng content thật, giữ đúng vị trí/cấp heading.
- Checkout 3 bước (006–008) dùng chung layout 2 cột: form trái + order summary phải.
