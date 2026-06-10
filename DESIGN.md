# DESIGN.md — Hệ thống thiết kế dự án

> **Nguồn**: Extract trực tiếp từ file `Elma eCommerce UI Kit.fig` (44 fill styles, 59 text styles, 5 effect styles, 9.329 nodes).
> **Mục đích**: File này là **nguồn chân lý duy nhất** về giao diện. Claude (hoặc dev) PHẢI đọc và tuân thủ file này mỗi khi code UI. Mọi giá trị thiết kế lấy từ đây — không tự bịa màu/font/size mới.

---

## 1. Quy tắc bắt buộc

1. **KHÔNG hardcode** hex/px trong component. Chỉ dùng CSS variables hoặc Tailwind tokens định nghĩa ở mục 2 & 7.
2. Dark mode hoạt động bằng cách **đổi semantic variables** qua class `.dark` trên `<html>` — KHÔNG viết style dark riêng cho từng component, KHÔNG dùng `dark:` cho màu đã có semantic token.
3. Heading dùng **Rubik**, body/UI text dùng **Roboto**. Không thêm font khác.
4. Border radius mặc định = **8px** (`--radius-md`). Pill/avatar = `--radius-full`.
5. Shadow chỉ dùng 5 mức elevation ở mục 6. Không tự chế `box-shadow`.
6. Mọi component interactive phải đủ states: `default / hover / active / disabled / focus-visible` (focus ring indigo, mục 8).
7. Text trên nền `warning` (#EEC200) và `teal` (#47C1BF) phải dùng màu ink đậm — text trắng trên 2 màu này FAIL contrast AA.
8. Gặp màu trong mockup lệch nhẹ so với token (vd `#959EAD`, `#C4C4C4`, `#D8D8D8`) → quy về token gần nhất, không thêm token mới.
9. Trang/màn hình không có mockup (mobile, page mới): suy từ token system này — cùng palette, cùng type scale, cùng spacing. Không "sáng tạo" ngoài hệ thống.
10. Muốn thêm màu mới → thêm vào file này trước (cả 2 mode), rồi mới dùng trong code.

---

## 2. Color tokens — CSS Variables (2 mode)

> **Bản runtime đầy đủ** (12-step scales, shadcn aliases, Tailwind v4 `@theme`): `packages/ui/styles/tokens.css` — đã đối chiếu với .fig ngày 2026-06-11. Block dưới là bản rút gọn để đọc nhanh; khi 2 bản lệch nhau, tokens.css là chuẩn.

```css
/* ===== LIGHT (mặc định) ===== */
:root {
  color-scheme: light;

  /* Brand / Primary (Indigo) */
  --color-primary: #5c6ac4;
  --color-primary-hover: #4f5ba9; /* derived: darken 12% */
  --color-primary-active: #43467f; /* style: Fill/Action/TIttle */
  --color-primary-subtle: rgb(92 106 196 / 0.1); /* bg cho soft button, badge, selected row */

  /* Nền & bề mặt */
  --color-bg: #f9fafb; /* nền trang — White Fill/Lighter */
  --color-bg-subtle: #f4f6f8; /* section xen kẽ, table header — Enough Light */
  --color-surface: #ffffff; /* card, modal, input, dropdown */
  --color-border: #c4cdd5; /* viền input, card outline */
  --color-border-subtle: #eaeaea; /* divider mảnh (usage-derived) */

  /* Chữ */
  --color-text-strong: #161d25; /* heading — Dark Fill/Tittle */
  --color-text: #212b36; /* mặc định — Dark Fill/Ink */
  --color-text-secondary: #454f5b;
  --color-text-muted: #637381; /* caption, placeholder */
  --color-text-disabled: #919eab;
  --color-text-inverse: #ffffff;
  /* Cặp màu landing/marketing sections (dùng rất nhiều trong kit): */
  --color-text-navy: #183b56; /* heading landing */
  --color-text-slate: #5a7184; /* body landing */

  /* Semantic / Action colors */
  --color-info: #006fbb;
  --color-success: #50b83c;
  --color-warning: #eec200;
  --color-attention: #f49342; /* orange — alert nhẹ, sao đánh giá */
  --color-danger: #de3618;
  --color-accent-teal: #47c1bf;
  --color-accent-purple: #9c6ade;

  /* Nền nhạt cho badge / alert / toast */
  --color-info-subtle: rgb(0 111 187 / 0.1);
  --color-success-subtle: rgb(80 184 60 / 0.12);
  --color-warning-subtle: rgb(238 194 0 / 0.14);
  --color-danger-subtle: rgb(222 54 24 / 0.1);

  /* Focus */
  --focus-ring: 0 0 0 3px rgb(92 106 196 / 0.35);
}

/* ===== DARK ===== */
.dark {
  color-scheme: dark;

  --color-primary: #8791d4; /* derived: indigo +L cho contrast nền tối */
  --color-primary-hover: #9aa3de;
  --color-primary-active: #5c6ac4;
  --color-primary-subtle: rgb(135 145 212 / 0.14);

  --color-bg: #161d25; /* Dark Fill/Tittle */
  --color-bg-subtle: #1b242e; /* derived */
  --color-surface: #212b36; /* Dark Fill/Ink */
  --color-border: #454f5b; /* Dark Fill/Light */
  --color-border-subtle: #333d48; /* derived */

  --color-text-strong: #ffffff;
  --color-text: #f9fafb;
  --color-text-secondary: #c4cdd5;
  --color-text-muted: #919eab;
  --color-text-disabled: #637381;
  --color-text-inverse: #212b36;
  --color-text-navy: #c4cdd5; /* navy không dùng được trên nền tối */
  --color-text-slate: #919eab;

  --color-info: #39a6ef; /* derived: +L */
  --color-success: #76cd65; /* derived: +L */
  --color-warning: #eec200;
  --color-attention: #f49342;
  --color-danger: #eb6047; /* derived: +L */
  --color-accent-teal: #47c1bf;
  --color-accent-purple: #b18ce8; /* derived: +L */

  --color-info-subtle: rgb(57 166 239 / 0.14);
  --color-success-subtle: rgb(118 205 101 / 0.14);
  --color-warning-subtle: rgb(238 194 0 / 0.12);
  --color-danger-subtle: rgb(235 96 71 / 0.14);

  --focus-ring: 0 0 0 3px rgb(135 145 212 / 0.45);
}
```

Toggle dark mode:

```js
// đọc lựa chọn đã lưu hoặc theo hệ điều hành
const theme =
  localStorage.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.classList.toggle('dark', theme === 'dark');
// khi user bấm nút: toggle class 'dark' + lưu localStorage.theme
```

---

## 3. Bảng màu primitive (tham chiếu nguồn)

| Token            | Hex       | Nguồn trong Figma                 |
| ---------------- | --------- | --------------------------------- |
| ink-900          | `#161D25` | Dark Fill/Tittle                  |
| ink-800          | `#212B36` | Dark Fill/Ink                     |
| ink-600          | `#454F5B` | Dark Fill/Light                   |
| ink-500          | `#637381` | Dark Fill/Lighter                 |
| ink-400          | `#919EAB` | Dark Fill/Lightest                |
| sky-300          | `#C4CDD5` | White Fill/Dark Light             |
| sky-100          | `#F4F6F8` | White Fill/Enough Light           |
| sky-50           | `#F9FAFB` | White Fill/Lighter                |
| white            | `#FFFFFF` | Fill/White/White                  |
| indigo (primary) | `#5C6AC4` | Fill/Action/Indigo                |
| indigo-deep      | `#43467F` | Fill/Action/TIttle                |
| blue             | `#006FBB` | Fill/Action/Blue                  |
| green            | `#50B83C` | Fill/Action/Green                 |
| yellow           | `#EEC200` | Fill/Action/Yellow                |
| orange           | `#F49342` | Fill/Action/Orange                |
| red              | `#DE3618` | Fill/Action/Red                   |
| teal             | `#47C1BF` | Fill/Action/Teal                  |
| purple           | `#9C6ADE` | Fill/Action/Purple                |
| navy             | `#183B56` | usage: heading landing (113 node) |
| slate            | `#5A7184` | usage: body landing (616 node)    |

---

## 4. Typography

Import font:

```css
@import url('https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&family=Roboto:wght@400;500;700&display=swap');
```

```css
--font-heading: 'Rubik', system-ui, sans-serif;
--font-sans: 'Roboto', system-ui, sans-serif;
```

### Heading — Rubik, letter-spacing 0.2px (0.16px với size ≤14)

| Token    | Size/Line-height | Weight  | Dùng cho            |
| -------- | ---------------- | ------- | ------------------- |
| display  | 56/72            | 700     | Hero desktop        |
| h1       | 48/64            | 700     | Tiêu đề trang       |
| h2       | 40/56            | 700     | —                   |
| h2-sm    | 36/52            | 700     | h2 mobile           |
| h3       | 32/48            | 700     | —                   |
| h3-sm    | 28/44            | 700     | h3 mobile           |
| h4       | 24/32            | 500–700 | Tiêu đề card lớn    |
| h5       | 20/24            | 500     | Tiêu đề card, modal |
| h6       | 18/20            | 500     | —                   |
| subtitle | 16/20            | 500     | Tiêu đề nhỏ, tab    |
| label    | 14/20            | 500     | Label form, menu    |
| overline | 12/16            | 500     | Eyebrow, badge text |

### Body — Roboto, letter-spacing 0

Hai scale theo đúng kit:

| Mục đích                                         | Sizes (size/lh)                           |
| ------------------------------------------------ | ----------------------------------------- |
| **Đoạn văn dài** (blog, mô tả sản phẩm — thoáng) | 20/36 · 18/32 · **16/28** · 14/24 · 12/20 |
| **UI text** (button, table, input, menu — chặt)  | 20/28 · 18/24 · 16/22 · **14/20** · 12/18 |

Mặc định: body đoạn văn = 16/28; UI component = 14/20. Weight: 400 mặc định, 500 nhấn, 700 rất nhấn.

---

## 5. Spacing, Radius, Border

**Radius** (đo từ tần suất sử dụng thực tế — 8px chiếm áp đảo):

```css
--radius-sm: 4px; /* checkbox, tag nhỏ */
--radius-md: 8px; /* MẶC ĐỊNH: button, input, card */
--radius-lg: 12px; /* card lớn, modal */
--radius-xl: 16px; /* hero block, ảnh lớn */
--radius-full: 999px; /* pill, avatar, badge tròn */
```

**Spacing**: grid 4px (mọi line-height trong kit chia hết cho 4). Scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Padding card chuẩn: 16–24px. Gap section landing: 48–64px (desktop), 32–40px (mobile).

**Layout**: container max `1110px` (khớp track từ .fig: 3×350+2×30 = 4×255+3×30 = 2×540+30 = 1110), column gap `30px`.

**Border**: 1px `--color-border`; input focus: 1px `--color-primary` + focus ring.

---

## 6. Elevation (Shadows)

5 mức từ kit — blur tăng, alpha giảm dần (bóng càng cao càng loãng):

```css
--shadow-1: 0 12px 16px rgb(0 0 0 / 0.08); /* card hover, dropdown */
--shadow-2: 0 16px 20px rgb(0 0 0 / 0.06); /* card nổi, popover */
--shadow-3: 0 20px 24px rgb(0 0 0 / 0.04); /* drawer */
--shadow-4: 0 28px 32px rgb(0 0 0 / 0.03); /* modal */
--shadow-5: 0 32px 36px rgb(0 0 0 / 0.02); /* hero/marketing block */
```

Card mặc định: KHÔNG shadow, chỉ border — shadow xuất hiện khi hover/nổi. **Dark mode**: shadow kém tác dụng → tăng alpha VÀ thêm `border: 1px solid var(--color-border-subtle)` cho bề mặt nổi.

---

## 7. Tailwind mapping

Runtime thật nằm ở `packages/ui/styles/tokens.css` (Tailwind v4 `@theme inline` đầy đủ — gồm cả 12-step scales, shadcn aliases). Quy ước sử dụng:

- Ưu tiên **semantic utilities**: `bg-bg-page`, `bg-bg-elevated`, `text-text-primary`, `text-text-muted`, `border-border-default`, `bg-brand-solid`, `text-h4`, `rounded-md`, `shadow-1`, `font-heading`...
- Raw scales (`bg-slate-3`, `bg-indigo-9`...) là escape hatch — hạn chế dùng trực tiếp trong component.
- KHÔNG dùng palette mặc định của Tailwind (`bg-blue-500`, `text-gray-600`...) — đã bị thay bằng token hệ thống.

---

## 8. Component conventions (theo variants trong kit)

Kit định nghĩa 3 kiểu fill cho mỗi action color — áp dụng làm button/badge variants:

| Variant               | Nền                | Chữ                                              | Viền                           |
| --------------------- | ------------------ | ------------------------------------------------ | ------------------------------ |
| `solid`               | màu action         | trắng (riêng yellow/teal: `--color-text-strong`) | —                              |
| `soft` ("Fill Light") | `--color-*-subtle` | màu action                                       | —                              |
| `outline`             | trong suốt         | màu action                                       | 1px màu action                 |
| `ghost`               | trong suốt         | `--color-text`                                   | — (hover: `--color-bg-subtle`) |

**Button**: height 32 (sm) / 40 (md) / 48 (lg); padding-x 12/16/24; radius `--radius-md`; text Roboto Medium 14 (sm/md) hoặc 16 (lg).
**States**: hover = `--color-primary-hover` (hoặc darken 12%); active = `--color-primary-active` (#43467F); disabled = nền `--color-bg-subtle` + chữ `--color-text-disabled`; focus-visible = `box-shadow: var(--focus-ring)`.
**Input**: nền `--color-surface`, viền `--color-border`, placeholder `--color-text-muted`, height 40–48, radius `--radius-md`.
**Card**: nền `--color-surface`, viền 1px `--color-border-subtle`, radius `--radius-lg`, padding 16–24.
**Badge trạng thái** (đơn hàng, tồn kho): dùng variant `soft` — success/warning/danger/info.

Mapping ngữ nghĩa: primary = indigo · info = blue · success = green · warning = yellow · chú ý nhẹ = orange · danger = red · teal/purple = trang trí, biểu đồ, tag marketing.

---

## 9. Dark mode — quy tắc chuyển đổi

- Cái gì **đổi**: toàn bộ semantic vars (tự động qua class `.dark`). Bề mặt sáng → tối theo cặp: trang `#F9FAFB→#161D25`, card `#FFFFFF→#212B36`, viền `#C4CDD5→#454F5B`.
- Cái gì **giữ nguyên**: hue thương hiệu (indigo), yellow, orange, teal; layout, spacing, radius, typography.
- Ảnh sản phẩm: bọc trong nền `--color-surface`, không filter ảnh.
- Không dùng đen tuyền `#000` và trắng tuyền cho text dài (dùng `#F9FAFB`).
- Test cả 2 mode trước khi xong — đặc biệt: border có nhìn thấy không, chữ muted có đọc được không, focus ring có nổi không.

---

## 10. Nguồn gốc dữ liệu

- **Extract từ file .fig** (chính xác 100%): toàn bộ hex mục 3, typography scale mục 4, 5 shadows mục 6, radius 8px phổ biến nhất, font Rubik/Roboto, container 1110 + tracks 350/255/540.
- **Derived** (kit gốc KHÔNG có dark mode & hover): toàn bộ block `.dark`, các giá trị `*-hover`, `*-subtle`, spacing scale, kích thước button. Đã tính theo chuẩn contrast trên nền tối — được phép tinh chỉnh nhẹ các giá trị derived nếu designer yêu cầu, nhưng phải cập nhật lại file này.
- **Lịch sử đối chiếu**: bản tokens.css cũ (extract từ ảnh) có 6 lỗi đã sửa ngày 2026-06-11: font Poppins→Rubik/Roboto, `#161B25`→`#161D25`, shadows sai toàn bộ, container 1100→1110, body line-height lệch, thiếu indigo-deep/navy/slateblue.

---

## 11. Checklist trước khi hoàn thành UI

- [ ] Không còn hex/px hardcode (search `#` trong diff)
- [ ] Đủ states: hover / active / disabled / focus-visible
- [ ] Render đúng ở cả `light` và `dark`
- [ ] Heading = Rubik, body = Roboto, đúng scale mục 4
- [ ] Contrast AA: đặc biệt text trên yellow/teal, text muted trên bg-subtle
- [ ] Radius/shadow lấy từ token, spacing chia hết cho 4
