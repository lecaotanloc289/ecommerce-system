import type { LiveSessionStatus, Money } from '@repo/core';

/**
 * Mock live sessions. Display shape that mirrors core `LiveSession` (ids are plain strings
 * here, not branded ULIDs) plus storefront-only `vendorName` / `poster`. Replaced by `@repo/sdk`
 * responses (`GET /v1/live-sessions`) when the live pages move to the API.
 */
export interface MockLiveSessionProduct {
  productId: string;
  position: number;
  pinnedAt: string | null;
}

export interface MockLiveSession {
  id: string;
  vendorId: string;
  vendorName: string;
  title: string;
  status: LiveSessionStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  peakViewers: number;
  /** Cloudflare Stream iframe player URL; null until provisioned / recorded. */
  playback: { iframeUrl: string } | null;
  /** Storefront-only thumbnail. */
  poster: string;
  products: MockLiveSessionProduct[];
}

const poster = (seed: string) => `https://picsum.photos/seed/${seed}/720/1280`;
// Public Cloudflare Stream demo video — stands in for a real live input / recording.
const demoPlayback = {
  iframeUrl:
    'https://customer-f33zs165nr7gyfy4.cloudflarestream.com/6b9e68b07dfee8cc2d116e4c51d6a957/iframe',
};

const productsOf = (
  ids: string[],
  pinnedId?: string,
  pinnedAt?: string,
): MockLiveSessionProduct[] =>
  ids.map((productId, position) => ({
    productId,
    position,
    pinnedAt: productId === pinnedId ? (pinnedAt ?? null) : null,
  }));

export const liveSessions: MockLiveSession[] = [
  {
    id: 'live-sony-launch',
    vendorId: 'v-sony',
    vendorName: 'Sony Official Store',
    title: 'Sony Alpha 4K launch: hands-on and live deals',
    status: 'LIVE',
    scheduledAt: '2026-11-23T12:00:00.000Z',
    startedAt: '2026-11-23T12:03:00.000Z',
    endedAt: null,
    peakViewers: 1280,
    playback: demoPlayback,
    poster: poster('live-sony'),
    products: productsOf(['p1', 'p3', 'p8'], 'p1', '2026-11-23T12:10:00.000Z'),
  },
  {
    id: 'live-apple-night',
    vendorId: 'v-apple',
    vendorName: 'Apple Store Official',
    title: 'Apple night: watch, AirPods and MacBook picks',
    status: 'SCHEDULED',
    scheduledAt: '2026-11-25T13:00:00.000Z',
    startedAt: null,
    endedAt: null,
    peakViewers: 0,
    playback: null,
    poster: poster('live-apple'),
    products: productsOf(['p2', 'p4', 'p6']),
  },
  {
    id: 'live-fashion-winter',
    vendorId: 'v-fashion',
    vendorName: 'Urban Threads',
    title: 'Winter lookbook: layering with Urban Threads',
    status: 'ENDED',
    scheduledAt: '2026-11-18T11:00:00.000Z',
    startedAt: '2026-11-18T11:02:00.000Z',
    endedAt: '2026-11-18T12:05:00.000Z',
    peakViewers: 860,
    playback: demoPlayback,
    poster: poster('live-fashion'),
    products: productsOf(['p7']),
  },
  {
    id: 'live-lenovo-work',
    vendorId: 'v-lenovo',
    vendorName: 'Lenovo Flagship',
    title: 'Work from anywhere: Yoga X deep dive',
    status: 'ENDED',
    scheduledAt: '2026-11-12T12:00:00.000Z',
    startedAt: '2026-11-12T12:01:00.000Z',
    endedAt: '2026-11-12T12:50:00.000Z',
    peakViewers: 412,
    // Recording not ready yet: exercises the "replay is being processed" state.
    playback: null,
    poster: poster('live-lenovo'),
    products: productsOf(['p5']),
  },
];

/**
 * Display-only products shown in the mock sessions. Not in the real catalog, so the live UI
 * renders them without product links or add-to-cart until it reads the API.
 */
export interface MockLiveProduct {
  id: string;
  title: string;
  image: string;
  price: Money;
  inStock: boolean;
}

const img = (seed: string) => `https://picsum.photos/seed/${seed}/640/640`;
const vnd = (amount: number): Money => ({ amount, currency: 'VND' });

export const liveProducts: MockLiveProduct[] = [
  {
    id: 'p1',
    title: 'Sony Alpha Mirrorless 4K Video Camera (Body Only)',
    image: img('sony-alpha'),
    price: vnd(49_990_000),
    inStock: true,
  },
  {
    id: 'p2',
    title: 'Apple Watch 4 2020 GPS 44mm',
    image: img('apple-watch'),
    price: vnd(9_990_000),
    inStock: true,
  },
  {
    id: 'p3',
    title: 'Beats by Dre C 3450 Wireless Headphones',
    image: img('beats'),
    price: vnd(4_500_000),
    inStock: true,
  },
  {
    id: 'p4',
    title: 'Airpods 2nd Gen with Charging Case',
    image: img('airpods'),
    price: vnd(3_290_000),
    inStock: true,
  },
  {
    id: 'p5',
    title: 'Lenovo Yoga X Convertible Laptop',
    image: img('lenovo-yoga'),
    price: vnd(32_000_000),
    inStock: true,
  },
  {
    id: 'p6',
    title: 'Macbook Pro 2018 13" 256GB',
    image: img('macbook'),
    price: vnd(28_500_000),
    inStock: true,
  },
  {
    id: 'p7',
    title: 'Women Yellow Turtleneck Sweater',
    image: img('turtleneck'),
    price: vnd(650_000),
    inStock: true,
  },
  {
    id: 'p8',
    title: 'Xiaomi Mi Band 7 Smart Fitness Tracker',
    image: img('mi-band'),
    price: vnd(990_000),
    inStock: true,
  },
];

export function getLiveProduct(id: string): MockLiveProduct | undefined {
  return liveProducts.find((p) => p.id === id);
}

export function getLiveSession(id: string): MockLiveSession | undefined {
  return liveSessions.find((s) => s.id === id);
}

/** No client auth exists yet — flip to preview the signed-in chat composer. */
export const mockLiveUser = { isSignedIn: false, displayName: 'You' } as const;

export interface MockChatLine {
  displayName: string;
  text: string;
}

/** Viewer chat lines (user content, not UI copy). The first few are seeded, the rest stream in. */
export const liveChatLines: MockChatLine[] = [
  { displayName: 'Minh Anh', text: 'Hello shop!' },
  { displayName: 'Hoang', text: 'Máy này quay 4K có chống rung không ạ?' },
  { displayName: 'Lan Pham', text: 'Màu bạc còn hàng không shop' },
  { displayName: 'Tuan', text: 'Giá live hôm nay là bao nhiêu vậy' },
  { displayName: 'Sophie', text: 'Love the design' },
  { displayName: 'Khoa', text: 'Có trả góp 0% không ạ?' },
  { displayName: 'Mai', text: 'Mình mới chốt đơn rồi nha' },
  { displayName: 'Daniel', text: 'Does it ship to Singapore?' },
  { displayName: 'Thu Ha', text: 'Cho xem cận cảnh ống kính đi shop' },
  { displayName: 'Bao', text: 'Pin dùng được bao lâu vậy' },
  { displayName: 'Linh', text: 'Đẹp quá trời' },
  { displayName: 'Viet', text: 'Có kèm thẻ nhớ không?' },
  { displayName: 'Emma', text: 'Great demo, thanks!' },
  { displayName: 'Quang', text: 'Bảo hành mấy tháng shop ơi' },
  { displayName: 'Ngoc', text: 'Mua 2 cái có giảm thêm không' },
  { displayName: 'Phuc', text: 'Ship hỏa tốc được không' },
  { displayName: 'Trang', text: 'Chốt 1 cái nhé' },
  { displayName: 'Lucas', text: 'Is the strap included?' },
  { displayName: 'Hanh', text: 'Shop reply giúp mình với' },
  { displayName: 'Son', text: 'Xịn quá, đã thêm vào giỏ' },
];
