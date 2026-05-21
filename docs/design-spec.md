# Elma e-Commerce — Design Spec

> Source: Figma "Elma eCommerce UI Kit" (file `VDvDb9XekKo81Ymqm5tfpF`).
> Reference exports captured locally at `~/Downloads/Elma eCommerce UI Kit/` (14 PNGs, 001–012).
> This spec is the **visual contract** for `apps/web` (storefront) and the customer-facing portions of `apps/admin`.
> It must be reconciled with the business rules in [`CLAUDE.md`](../CLAUDE.md). When the kit conflicts with a Golden Rule or NEVER-DO entry, **CLAUDE.md wins** — see the [Gaps vs project rules](#gaps-vs-project-rules) section at the bottom.

---

## Screens covered

| #               | File                                    | Purpose                                                                                            |
| --------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 001             | `001 Homepage - with Symbol.png`        | Storefront home: hero, feature strip, best sellers, promo, categories, product lists, blog, brands |
| 002             | `002 Shop Categories.png`               | Category index w/ sub-category cards + brand grid                                                  |
| 003             | `003 Search result - Grid.png`          | Search results: sidebar filters + product grid + pagination                                        |
| 004             | `004 Product Details.png`               | PDP: gallery, variants, qty, tabs (Description / Reviews / Related), review composer               |
| 005             | `005 Shopping Cart.png`                 | Cart: line items + order summary + voucher + recommendations                                       |
| 006             | `006 Checkout - Customer Info.png`      | Checkout step 2: customer form + summary                                                           |
| 007             | `007 Checkout - Shipping & Payment.png` | Checkout step 3: shipping radios + payment radios + card form                                      |
| 008             | `008 Checkout - Review order.png`       | Checkout step 4: address card, payment card, items, finalize                                       |
| 009             | `009 Order success.png`                 | Post-purchase confirmation + tracking CTA                                                          |
| 010             | `010 Track Order.png`                   | Order tracking: stepper + event log + summary + help                                               |
| 011             | `011 Register.png`                      | Register w/ OAuth + value-prop column                                                              |
| 011 Alt         | `011 Register Alt.png`                  | Register compact w/ promo image card                                                               |
| 011 Sign In Alt | `011 Sign In Alt.png`                   | Sign-in compact w/ benefit cards                                                                   |
| 012             | `012 Sign In.png`                       | Sign-in primary w/ OAuth + promo carousel                                                          |

---

## 1. INVENTORY (component count across 14 screens)

| Component                                                                                   |    Count | Appears on                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | -------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header (top utility bar + main nav)                                                         |       13 | all except 009 (009 uses minimal header)                                                                                                                                     |
| Footer (4-column menu + copyright)                                                          |       14 | all                                                                                                                                                                          |
| Logo "Elma"                                                                                 |       14 | all                                                                                                                                                                          |
| Search bar + Category dropdown + Search button                                              |       13 | all w/ full header                                                                                                                                                           |
| Cart icon w/ red badge                                                                      |       13 | all w/ full header                                                                                                                                                           |
| Wishlist (heart) icon                                                                       |       13 | all w/ full header                                                                                                                                                           |
| User avatar + "Join Elma / My Account"                                                      |       13 | all w/ full header                                                                                                                                                           |
| Language switcher (flag + dropdown)                                                         |       14 | all                                                                                                                                                                          |
| Top utility links (Order tracking, Help)                                                    |       14 | all                                                                                                                                                                          |
| Social icons (FB, TW, YT, IG, GitHub)                                                       |       14 | header + footer                                                                                                                                                              |
| Button — primary solid (indigo)                                                             |      ~25 | Buy Now, Add to cart, Login, Sign In, Create account, Submit Review, Track your order, Proceed to Checkout, Continue to Shipping, Review your Order, Finalize Order, Call Us |
| Button — secondary outline                                                                  |      ~12 | Learn More, Back to shopping, Go to Homepage, View All, Edit info, Register, Submit Card Info                                                                                |
| Button — ghost / text link                                                                  |      ~10 | View More Products, Forgot Password, Register here, Sign in here, Change method                                                                                              |
| Button — social OAuth (Google / FB / Twitter)                                               |        4 | 011, 011 Alt, 011 Sign In Alt, 012                                                                                                                                           |
| Product card (image + title + price + vendor + rating)                                      |      ~40 | 001 (best seller 8, list 3×3, related), 003 (12 grid), 004 (related 4), 005 (recommendations 6)                                                                              |
| Promo / hero banner (large image + title + CTA)                                             |        3 | 001 hero, 001 Lenovo Yoga X, 012 Crazy Deals                                                                                                                                 |
| Promo card small (image + caption)                                                          |        1 | 011 "Discount 25%"                                                                                                                                                           |
| Feature strip (icon + title + description)                                                  |   2 sets | 001 (4 icons), 011 (3 items), 011 Alt (4 cards)                                                                                                                              |
| Category card (image + title + 5 sublinks + item count)                                     |        6 | 002                                                                                                                                                                          |
| Category icon tile (icon + name + count)                                                    |        6 | 001 Category section                                                                                                                                                         |
| Brand logo tile                                                                             |        8 | 002                                                                                                                                                                          |
| Brand logo strip (grayscale)                                                                |        6 | 001, 011 Alt, 011 Sign In Alt, 012 footer area                                                                                                                               |
| Blog card (image + meta + title)                                                            |        3 | 001                                                                                                                                                                          |
| Breadcrumb                                                                                  |        6 | 002, 003, 005, 006, 007, 008                                                                                                                                                 |
| Filter panel — Popular filter (checkbox list)                                               |        1 | 003                                                                                                                                                                          |
| Filter panel — Category list (icon + name + count)                                          |        1 | 003                                                                                                                                                                          |
| Filter panel — Price slider (dual handle)                                                   |        1 | 003                                                                                                                                                                          |
| Filter panel — Color swatch picker                                                          |        1 | 003                                                                                                                                                                          |
| Sort dropdown                                                                               |        1 | 003                                                                                                                                                                          |
| View toggle (grid / list)                                                                   |        1 | 003                                                                                                                                                                          |
| Pagination (numbered + prev / next)                                                         |        1 | 003                                                                                                                                                                          |
| Tab bar (Descriptions / Reviews / Related Product)                                          |        1 | 004                                                                                                                                                                          |
| Stepper / Quantity input (− value +)                                                        |       4+ | 004, 005, 006, cart rows                                                                                                                                                     |
| Variant chip selector                                                                       | 2 groups | 004 (Body Only / Black / Original / Blue)                                                                                                                                    |
| Thumbnail strip (small product images)                                                      |        1 | 004                                                                                                                                                                          |
| Rating stars (5-star, partial fill)                                                         |     many | product cards, reviews                                                                                                                                                       |
| Rating distribution bars (5→1 stars w/ count)                                               |        1 | 004                                                                                                                                                                          |
| Review item (avatar + name + date + stars + body + actions)                                 |        3 | 004                                                                                                                                                                          |
| Review composer (form: name, email, rating select, textarea)                                |        1 | 004                                                                                                                                                                          |
| Cart line item row (thumb + title + price + qty + remove)                                   |        5 | 005, 006, 008                                                                                                                                                                |
| Order summary panel (subtotal, tax, discount, total, voucher, CTA)                          |        4 | 005, 006, 007, 008                                                                                                                                                           |
| Voucher / promo input (input + Apply button)                                                |        4 | 005, 006, 007, 008                                                                                                                                                           |
| Checkout stepper (4 dots: Cart → Customer → Shipping & Payment → Review)                    |        4 | 005, 006, 007, 008                                                                                                                                                           |
| Text input (single-line, label above)                                                       |     many | 004, 006, 007, 011, 012                                                                                                                                                      |
| Phone input (country code + number)                                                         |        2 | 006, 011                                                                                                                                                                     |
| Country / region select                                                                     |        1 | 006                                                                                                                                                                          |
| Select / dropdown native                                                                    |       ~8 | gender, month / year, sort, category                                                                                                                                         |
| Checkbox + label                                                                            |       ~6 | popular filter, save customer, stay signed, terms                                                                                                                            |
| Radio (shipping option)                                                                     |        5 | 007                                                                                                                                                                          |
| Radio card (Credit Card / Paypal payment method)                                            |        2 | 007                                                                                                                                                                          |
| Address card (avatar, name, phone, address, Edit info)                                      |        1 | 008                                                                                                                                                                          |
| Payment method summary card (Mastercard)                                                    |        1 | 008                                                                                                                                                                          |
| Order success illustration (gradient ring + check)                                          |        1 | 009                                                                                                                                                                          |
| Tracking stepper (5 status dots: Order Placed → Packed → On shipping → Received → Reviewed) |        1 | 010                                                                                                                                                                          |
| Tracking event log (timeline list w/ status + timestamp)                                    |        1 | 010                                                                                                                                                                          |
| Help / Trouble CTA card (text + Call Us button)                                             |        1 | 010                                                                                                                                                                          |
| Auth form — full (name, email, gender, phone, password, repeat, CTA)                        |        1 | 011                                                                                                                                                                          |
| Auth form — compact (email, password, remember, CTA)                                        |        2 | 011 Sign In Alt, 012                                                                                                                                                         |
| Auth form — register compact (name, email, phone, password, repeat, terms)                  |        1 | 011 Alt                                                                                                                                                                      |
| Carousel dots indicator                                                                     |        2 | 011 promo, 012 promo                                                                                                                                                         |
| Hero arrow nav (left / right)                                                               |        1 | 001                                                                                                                                                                          |
| Badge — discount (red "SALE")                                                               |     many | 003, 004 related                                                                                                                                                             |
| Badge — count (red dot on cart, heart)                                                      |       13 | header                                                                                                                                                                       |
| Badge — featured ("Featured Product")                                                       |        2 | 003, 011 promo overlay                                                                                                                                                       |
| Tag — discount %                                                                            |        2 | 005, 006, 007                                                                                                                                                                |
| FAQ-style accordion (chevron + label)                                                       |  6 lists | 002 categories sublinks                                                                                                                                                      |

---

## 2. DESIGN TOKENS

### Colors

> **Authoritative hex** taken from Figma "Colors" style-guide sheet (Polaris-style palette). All values implemented in `packages/ui/src/styles/tokens.css`.

**Fill Action (solid brand + accent + status anchors):**

| Token                        | Hex       | Role                                           |
| ---------------------------- | --------- | ---------------------------------------------- |
| `--color-info-9` (Blue)      | `#006FBB` | info accent                                    |
| `--color-purple-9` (Purple)  | `#9C6ADE` | secondary accent                               |
| `--color-indigo-9` (Indigo)  | `#5C6AC4` | **BRAND primary** (buttons, links, focus ring) |
| `--color-teal-9` (Teal)      | `#47C1BF` | tertiary accent                                |
| `--color-success-9` (Green)  | `#50B83C` | success / price-positive                       |
| `--color-warning-9` (Yellow) | `#EEC200` | warning / rating star                          |
| `--color-orange-9` (Orange)  | `#F49342` | warning-alt / promotional                      |
| `--color-danger-9` (Red)     | `#DE3618` | danger / sale price / delete                   |

**Neutral (Polaris dark + white fill scale):**

| Token                          | Hex       | Role                         |
| ------------------------------ | --------- | ---------------------------- |
| `--color-slate-12` (Tittle)    | `#161B25` | headings                     |
| `--color-slate-11` (Ink)       | `#212B36` | body text                    |
| `--color-slate-10` (Light)     | `#454F5B` | hover-dark, search submit bg |
| `--color-slate-9` (Lighter)    | `#637381` | muted text, icons            |
| `--color-slate-8` (Lightest)   | `#919EAB` | border strong, placeholder   |
| `--color-slate-6` (Dark Light) | `#C4CDD5` | border subtle                |
| `--color-slate-4` (Sky)        | `#DFE3E8` | element active               |
| `--color-slate-2` (Enough L.)  | `#F4F6F8` | surface bg, footer           |
| `--color-slate-1` (Lighter)    | `#F9FAFB` | page bg                      |

**Fill Light (category card backgrounds — pastel tints of Fill Action):**

| Token                            | Hex       | Use                             |
| -------------------------------- | --------- | ------------------------------- |
| `--color-tint-blue`              | `#D6EDF7` | hero blue card                  |
| `--color-tint-indigo`            | `#ECEEFB` | brand soft bg                   |
| `--color-tint-purple`            | `#EEDFFA` | category 5                      |
| `--color-tint-teal`              | `#CFE6E6` | accent card                     |
| `--color-tint-green`             | `#DFEFD3` | category 2 / free-shipping pill |
| `--color-tint-yellow`            | `#FCF1CD` | category 4                      |
| `--color-tint-orange`            | `#FCE5D0` | category 3                      |
| `--color-tint-red` / `tint-pink` | `#FBE5DF` | sale / danger soft              |

**Semantic (consumed by components, dark-mode aware):**
`--color-bg-page` · `--color-bg-surface` · `--color-bg-elevated` · `--color-bg-muted` · `--color-bg-inverse` · `--color-bg-overlay` · `--color-text-primary/body/muted/placeholder/disabled/on-primary/link/price/price-sale` · `--color-border-subtle/default/strong/focus/input` · `--color-brand-solid/-hover/-active/-soft/-text/-disabled` · `--color-{success,danger,warning,info}-{bg,fg,solid,border}` · `--color-rating-star`.

**shadcn aliases (legacy compatibility, route through semantic):**
`--background` · `--foreground` · `--card` · `--popover` · `--primary` · `--secondary` · `--muted` · `--accent` · `--destructive` · `--border` · `--input` · `--ring`.

### Typography

Font family: **Poppins** — single family, multi-weight.
Fallback stack: `Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

| Token        |  Size | Weight |  Line | Letter | Use                                                                                         |
| ------------ | ----: | -----: | ----: | -----: | ------------------------------------------------------------------------------------------- |
| `display-xl` |    48 |    700 |    60 |  -0.5% | hero "Best in Hi-Res…"                                                                      |
| `display-l`  |    40 |    700 |    52 | -0.25% | "Join with +2 Million…", "Enjoy all big benefits…"                                          |
| `h1`         |    36 |    700 |    44 |      0 | page titles "Shopping Cart", "Customer Information", "Shop categories", "Purchase Success!" |
| `h2`         | 28–30 |    700 |    40 |      0 | section titles ("Best Seller Products", "Reviews", "Related Products")                      |
| `h3`         | 22–24 |    700 |    32 |      0 | product detail title, card cluster header                                                   |
| `h4`         |    18 |    600 |    28 |      0 | card titles, brand tile label, blog title                                                   |
| `body-l`     |    16 |    400 |    24 |      0 | description, paragraph                                                                      |
| `body-m`     |    14 |    400 |    22 |      0 | product card title, list rows                                                               |
| `body-s`     |    13 |    400 |    20 |      0 | meta, helper, breadcrumb                                                                    |
| `caption`    |    12 |    500 |    16 |      0 | badges, count, footer copyright                                                             |
| `label`      |    13 |    500 |    18 |  0.25% | form labels                                                                                 |
| `price-l`    |    24 |    700 |    32 |      0 | product detail price                                                                        |
| `price-m`    |    16 |    600 |    22 |      0 | cart row price, summary total                                                               |
| `price-card` |    14 |    600 |    20 |      0 | product card price (red for sale, green for normal)                                         |
| `button`     | 14–16 |    600 | 20–24 |      0 | CTA labels                                                                                  |

### Spacing (4-pt base scale)

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96` px.

Most common gaps:

- `8` — chip padding, icon-to-label
- `12` — card inner padding
- `16` — input vertical rhythm
- `24` — section padding
- `32` — between cards
- `64 / 80` — between top-level sections

### Radius

| Token    |   px | Use                                                       |
| -------- | ---: | --------------------------------------------------------- |
| `r-sm`   |    4 | badge, tag                                                |
| `r-md`   |    6 | input, small button                                       |
| `r-lg`   |    8 | primary button, card                                      |
| `r-xl`   |   12 | promo card, hero, payment method card                     |
| `r-2xl`  |   16 | category card, brand tile                                 |
| `r-full` | 9999 | avatar, cart / heart icon bg, language flag, success ring |

### Shadow

| Level        | Spec (approx)                    | Use                               |
| ------------ | -------------------------------- | --------------------------------- |
| `shadow-0`   | none                             | flat cards on tinted bg           |
| `shadow-1`   | `0 1px 2px rgba(16,24,40,.05)`   | input focus subtle, table row     |
| `shadow-2`   | `0 4px 12px rgba(16,24,40,.06)`  | header sticky, product card hover |
| `shadow-3`   | `0 12px 24px rgba(16,24,40,.08)` | promo card, featured product card |
| `shadow-cta` | `0 8px 16px rgba(79,70,229,.25)` | primary button hover (implied)    |

---

## 3. COMPONENT ANATOMY (repeated ≥ 2 times)

### Button (primary / secondary / ghost / social)

- **Props:** `variant` (primary | secondary | ghost | social | destructive), `size` (sm 32 | md 40 | lg 48 | xl 56 px), `iconLeft`, `iconRight`, `fullWidth`, `loading`, `disabled`, `as` (button | link)
- **States visible in design:** default, disabled (Register w/ Google bar), pressed-like (search submit dark).
- **States missing but required:** `hover`, `focus-visible` (a11y ring, contrast 3:1 minimum), `active`, `loading` (spinner replaces label, click guarded), `success / error` toast feedback after async.

### Product card

- **Props:** `image`, `title`, `vendor` (e.g. "Apple Store Official"), `price`, `compareAtPrice` (strikethrough), `rating` (0–5), `reviewCount`, `saleBadge` (SALE | FEATURED), `wishlist` (bool, optimistic), `onClick`, `size` (compact in cart "you may like" vs full in grid)
- **States visible:** default, sale (red price + SALE badge), featured (highlighted card w/ blue bg + "View Store" CTA).
- **States missing:** hover (elevate + reveal Add-to-cart shortcut), out-of-stock (grayscale + "Sold out" badge), loading skeleton, image broken fallback, vendor link unreachable, wishlist optimistic-fail rollback.

### Input (text / email / phone / password)

- **Props:** `label`, `placeholder`, `value`, `helperText`, `errorText`, `prefix` (e.g. `+1` w/ flag), `suffix` (eye-toggle for password), `disabled`, `readOnly`, `required`, `autoComplete`, `inputMode`, `name`.
- **Visible:** default (filled "Gareth Barry"), empty (placeholder gray), password masked `****`.
- **Missing:** focus ring, error red border + helper text, success green tick, disabled gray fill, loading (async-validation spinner), invalid format (Zod schema feedback).

### Quantity stepper

- **Props:** `value`, `min` (1), `max` (stock), `step` (1), `onChange`, `disabled`.
- **Visible:** default, max-reached implied.
- **Missing:** at-min disable `−`, at-max disable `+`, async pending (debounce ~300ms for cart line update), error toast on stock conflict.

### Order summary panel

- **Props:** `lines` (subtotal, shipping, tax, discount), `total`, `voucher` (code, applied, removable), `cta` (label, onClick, loading), `currency`.
- **Visible:** default, voucher empty, discount applied (red `-$129.00`).
- **Missing:** voucher invalid (red helper), voucher applied chip removable, loading total recalc, free-shipping threshold progress, multi-currency switcher (VND + USD per CLAUDE.md).

### Checkout stepper

- **Props:** `steps` (4 fixed), `current` (0–3), `clickableBack` (bool).
- **Visible:** active dot (indigo + filled), past dot (indigo outline + check), upcoming dot (gray).
- **Missing:** error state per step (validation failed), skip-allowed indicator, mobile collapsed view (current step + count).

### Promo / hero banner

- **Props:** `image`, `title`, `subtitle`, `cta1`, `cta2`, `arrows` (bool), `dots` (count + index), `autoplay`, `interval`.
- **Visible:** static hero (001), promo card overlay (011 Discount 25%, 012 Crazy Deals).
- **Missing:** pause-on-hover, focus-visible on arrows, `prefers-reduced-motion` respect, image lazyload skeleton.

### Filter panel (sidebar)

- **Props:** `groups` (popular | category | price | color | brand…), `selected`, `onChange`, `collapsible`.
- **Visible:** checked checkbox, expanded category list, dual-handle price slider, color swatch row.
- **Missing:** "no results" state, "clear all" affordance, sticky on scroll, mobile bottom-sheet variant, async option counts updating after each filter applied (loading dots per group).

### Review item

- **Props:** `avatar`, `name`, `date`, `rating`, `body`, `attachments` (images), `helpful` (count + voted bool).
- **Visible:** default w/ thumbs-up / thumbs-down.
- **Missing:** reported state, vendor-reply nested block, edit / delete own-review, image lightbox open.

### Tracking stepper (timeline)

- **Props:** `stages` (5), `current` (0–4), `events` (list of `{ status, timestamp, location }`).
- **Visible:** active (On shipping = indigo filled w/ gradient ring), past (indigo check), future (gray outline).
- **Missing:** error stage (delivery failed → red), delayed warning (amber), ETA countdown, refresh action.

### Language switcher

- **Props:** `current` (locale code), `options` (`vi`, `en`), `onChange`.
- **Visible:** flag + label + chevron.
- **Missing:** dropdown open list, loading on locale-route push, persisted via cookie (next-intl pattern per project CLAUDE.md).

### Cart line row

- **Props:** `thumb`, `title`, `vendor`, `price`, `qty`, `onQtyChange`, `onRemove`, `maxQty`.
- **Visible:** default, hover-like (Remove icon visible).
- **Missing:** stock-conflict warning (qty > stock), price-changed banner (snapshot vs current), loading on qty mutate, removed-with-undo toast.

---

## 4. LAYOUT GRID

- **Container max-width:** `1100px` (Figma "Collumn" sheet — `width-size: 1100 px`). Outer page padding `24px` desktop, `16px` mobile.
- **Columns:** Figma defines three flat formulas at 1100 px:
  - **3-col:** `350 / 350 / 350` + 30 px gap (also asymmetric `350 / 730` and `730 / 350`)
  - **4-col:** `255 / 255 / 255 / 255` + 30 px gap (also `255 / 255 / 540`, `255 / 825`)
  - **2-col:** `540 / 540` + 30 px gap
- **Column gutter:** `30px` (constant across all formulas).
- **Section gap:** `64–80px` between top-level sections.
- **Two-column layouts:** auth + checkout pages → `~58 / 42` split (content `720` / aside `480`) with `40px` gutter.
- **Product grid:** desktop 4 cols (003 search), 3 cols (related, blog), 2 cols (small cart recommend). Card aspect ~1:1 image + ~120px text block.
- **Header:** sticky, height `80px` (utility row `40px` + main `80px` ≈ `120px` stack total).
- **Footer:** 4-column menu band + 1-row copyright. Padding `64px` top / `32px` bottom.

### Breakpoints (Tailwind defaults — confirm against mobile artboards before locking)

| Name  | Min width | Behavior                                     |
| ----- | --------: | -------------------------------------------- |
| `sm`  |       640 | single-col stack, hamburger nav              |
| `md`  |       768 | 2-col product grid, search collapsed         |
| `lg`  |      1024 | 3-col product grid, sidebar reveals          |
| `xl`  |      1280 | full desktop, 4-col grid, dual-pane checkout |
| `2xl` |      1536 | container caps at 1280, side gutters grow    |

---

## 5. INTERACTION MAP

| Trigger                                        | Destination / Action                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| Logo "Elma"                                    | `/` (home)                                                               |
| Hamburger (≡)                                  | open mega-menu drawer (categories)                                       |
| Search submit                                  | `/search?q=&category=` → 003                                             |
| Category dropdown                              | filter scope for search                                                  |
| Cart icon                                      | `/cart` → 005                                                            |
| Heart icon                                     | `/account/wishlist`                                                      |
| User avatar / "My Account"                     | dropdown: My Account / Orders / Logout                                   |
| "Join Elma"                                    | `/register` → 011                                                        |
| "Order tracking" (top util)                    | `/order-tracking` → 010                                                  |
| Help                                           | `/help`                                                                  |
| Language flag                                  | open locale dropdown (vi / en) — swap path prefix `/vi` ↔ `/en`          |
| Hero "Buy Now $0.00"                           | product detail of featured hero item → 004                               |
| Hero "Learn More"                              | `/about` or product-story page                                           |
| Hero arrows ◀ ▶                                | cycle hero carousel                                                      |
| Feature strip icons                            | static — no link or anchor scroll                                        |
| Best Seller card (image / title)               | `/product/:slug` → 004                                                   |
| Best Seller card add-to-cart on hover          | optimistic add to cart                                                   |
| Category tile (Apple, Mi…)                     | `/category/:slug` → 003                                                  |
| Category card sublinks (002)                   | `/category/:slug?sub=:id` → 003                                          |
| Brand tile (002)                               | `/brand/:slug`                                                           |
| Blog card                                      | `/blog/:slug`                                                            |
| Breadcrumb segment                             | route to that level                                                      |
| Sort dropdown (003)                            | re-fetch w/ `sort=` param                                                |
| View toggle (grid / list)                      | swap layout, persist to `localStorage`                                   |
| Filter checkbox / slider / swatch              | update URL search params, re-fetch products                              |
| "View Store" (featured product card 003)       | `/vendor/:id`                                                            |
| Add to wishlist (heart on card)                | toggle, optimistic w/ rollback on 401 → redirect login                   |
| Pagination number / prev / next                | scroll-top + re-fetch page                                               |
| Product page thumbnail                         | swap main image                                                          |
| Product variant chip                           | update SKU selector + price + image                                      |
| "Buy Now" (004)                                | direct checkout w/ this item → 006                                       |
| "Add to cart" (004)                            | POST `/cart` → toast → cart count badge++                                |
| Tab (Descriptions / Reviews / Related Product) | scroll-to-section or tab swap                                            |
| "Report Product"                               | open report modal (missing in design)                                    |
| "Share"                                        | open share menu                                                          |
| "Load more reviews"                            | paginate review list                                                     |
| "Submit Review"                                | post review (auth required, else login redirect)                         |
| Cart row qty stepper                           | PATCH `/cart/items/:id` debounced                                        |
| Cart row delete icon                           | DELETE `/cart/items/:id` w/ undo toast                                   |
| "Apply" voucher (005–008)                      | POST `/coupons/apply` → update summary                                   |
| "Proceed to Checkout" (005)                    | next step → 006                                                          |
| "Back to shopping" (005–008)                   | history back or `/`                                                      |
| Checkout step dot (clickable past steps)       | jump back to that step                                                   |
| "Continue to Shipping" (006)                   | validate → next → 007                                                    |
| Country select (006)                           | filter province / state options                                          |
| Shipping radio (007)                           | recalc shipping fee in summary                                           |
| Payment radio (Credit / Paypal)                | reveal correct payment form                                              |
| "Submit Card Info" (007)                       | tokenize card (Stripe Elements likely)                                   |
| "Review your Order" (007)                      | next step → 008                                                          |
| "Edit info" (008 address / payment)            | jump back to step 006 / 007                                              |
| "Change method" (008 payment)                  | open payment-method modal or jump to 007                                 |
| "Finalize Order" (008)                         | POST `/v1/orders/checkout` w/ `Idempotency-Key` (CLAUDE.md Rule 3) → 009 |
| "Track your order" (009)                       | `/order-tracking/:id` → 010                                              |
| "Back to shopping" (009)                       | `/`                                                                      |
| "Go to Homepage" (010)                         | `/`                                                                      |
| Track event log row                            | read-only                                                                |
| "Call Us" (010 trouble card)                   | `tel:+...`                                                               |
| "Register with Google" (011)                   | OAuth Google flow per CLAUDE.md Rule 5                                   |
| FB / Twitter mini-btns (011)                   | OAuth FB / Twitter (Twitter NOT in MVP — flag)                           |
| "Create Elma account" (011)                    | OAuth callback metadata capture (NOT password POST)                      |
| "Sign in here" (011)                           | `/login` → 012                                                           |
| "Login now" (011 Sign In Alt)                  | OAuth flow (NOT password POST)                                           |
| "Register" (011 Sign In Alt right CTA)         | `/register` → 011                                                        |
| "Sign In" (012)                                | OAuth flow → redirect intended URL                                       |
| "Register here" (012)                          | `/register` → 011                                                        |
| "Forgot Password" (012)                        | N/A — OAuth-only flow, link must be removed                              |
| Carousel dots (011, 012 promo)                 | swap promo slide                                                         |
| "Stay signed-in" checkbox                      | extend refresh-token cookie lifetime (Rule 5: refresh 30d HttpOnly)      |
| Footer column links                            | static routes                                                            |
| Footer social icons                            | external `_blank rel="noopener noreferrer"`                              |

---

## Gaps vs project rules

These items are present in the Figma kit but **violate or contradict** the constitution in [`CLAUDE.md`](../CLAUDE.md). Implementation must follow CLAUDE.md, not the kit.

1. **Email + password forms (screens 011, 012, 011 Alt, 011 Sign In Alt) violate Golden Rule #5 (OAuth only).**
   Drop the password / repeat-password fields and "Forgot Password" link. Keep the OAuth buttons + first-callback metadata capture (name, phone, gender) only.
2. **Twitter OAuth icon (011) is not in MVP.**
   CLAUDE.md lists Google + Facebook only. Remove or grey out the Twitter button.
3. **Currency shown only in USD (`$`).**
   `vi` locale + VND missing. The `Money` utility (Rule #2) must render both, with no floats. Localize via `@repo/i18n`.
4. **Order ID shown as `1234ABCD56EF` (12-char alphanumeric).**
   Project uses **ULID** (26-char). Swap in implementation.
5. **Vendor info on cards = single store label only.**
   Business model is **multi-vendor** (CLAUDE.md §1, §4). Cart + checkout summary need vendor grouping to visualize sub-orders. Extend the design before MVP — propose: cart line items grouped by vendor; order summary breaks subtotal per sub-order; checkout review (008) lists sub-orders not flat items.
6. **No shipping per sub-order in checkout (007).**
   Per CLAUDE.md §11, each vendor defines its own `ShippingMethod` and the customer picks **one method per sub-order**. The current single radio list does not support this. Extend: shipping radio block repeats per vendor group.
7. **No empty cart, out-of-stock, error, 404, vendor storefront, vendor application, admin screens, wishlist page in this kit.**
   Must be designed before MVP. Track as design backlog.
8. **No mobile artboards in the batch.**
   Breakpoint behavior in §4 is inferred. Confirm with mobile frames or scale tokens before locking.
9. ~~Hex values in §2 sampled from PNG export.~~ **Resolved 2026-05-21.** Authoritative hex now taken from Figma "Colors" + "Collumn" style-guide sheets (Polaris-style palette). Tokens live in [`packages/ui/src/styles/tokens.css`](../packages/ui/src/styles/tokens.css). Heading scale (Poppins sizes) still inferred — refine against `Heading - Black` + `Heading - White` sheets when needed.

---

## How to use this spec

- **Implementing a page:** locate the screen # → read the matching section in §1 (components present) → pull tokens from §2 → match interaction expectations in §5.
- **Building a component:** find it in §3 → implement all listed states (visible + missing) before claiming done.
- **Reviewing a PR:** reject any PR that hard-codes a color / font / radius not in §2 or skips a state listed in §3.
- **Conflict resolution:** CLAUDE.md > this spec > Figma file. If the kit shows behavior that breaks a Golden Rule, follow the rule and update the [Gaps vs project rules](#gaps-vs-project-rules) section.

---

_Source PNGs are local-only (not committed). Re-extract from Figma `VDvDb9XekKo81Ymqm5tfpF` when an account with view access is configured; then refresh §2 tokens from the file's variables._
