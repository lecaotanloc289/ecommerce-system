import { describe, expect, it } from 'vitest';
import {
  CheckoutSchema,
  ZaloLoginRecordSchema,
  ZaloLoginStateSchema,
  ZaloMessageListQuerySchema,
  ZaloTemplateUpsertSchema,
  findUnknownZaloPlaceholder,
  formatOrderCode,
  renderZaloTemplate,
  zaloEventForSubOrderStatus,
  type ZaloTemplateVars,
} from '../src';

const vars: ZaloTemplateVars = {
  customerName: 'An',
  orderCode: '#ABCDEFGH',
  shopName: 'Shop A',
  total: '150.000 ₫',
  itemList: '• Áo thun x2',
  carrier: 'GHN',
  trackingNumber: 'GHN123',
};

describe('zalo templates', () => {
  it('renders known placeholders, tolerating inner spaces', () => {
    expect(
      renderZaloTemplate('Chào {{customerName}}, đơn {{ orderCode }} của {{shopName}}', vars),
    ).toBe('Chào An, đơn #ABCDEFGH của Shop A');
  });

  it('leaves unknown placeholders verbatim and reports the first one', () => {
    expect(renderZaloTemplate('Hi {{nope}}', vars)).toBe('Hi {{nope}}');
    expect(findUnknownZaloPlaceholder('{{customerName}} {{nope}} {{other}}')).toBe('nope');
    expect(findUnknownZaloPlaceholder('{{customerName}} {{total}}')).toBeNull();
    expect(findUnknownZaloPlaceholder('no placeholders')).toBeNull();
  });

  it('upsert body: trims, defaults delay, rejects empty/oversized/negative', () => {
    expect(ZaloTemplateUpsertSchema.parse({ isEnabled: true, body: '  Hi  ' })).toEqual({
      isEnabled: true,
      body: 'Hi',
      delayMinutes: 0,
    });
    expect(ZaloTemplateUpsertSchema.safeParse({ isEnabled: true, body: '   ' }).success).toBe(
      false,
    );
    expect(
      ZaloTemplateUpsertSchema.safeParse({ isEnabled: true, body: 'x'.repeat(2001) }).success,
    ).toBe(false);
    expect(
      ZaloTemplateUpsertSchema.safeParse({ isEnabled: true, body: 'x', delayMinutes: -1 }).success,
    ).toBe(false);
  });

  it('maps sub-order statuses to events', () => {
    expect(zaloEventForSubOrderStatus('SHIPPED')).toBe('ORDER_SHIPPED');
    expect(zaloEventForSubOrderStatus('AWAITING_PAYMENT')).toBeNull();
  });

  it('formats the short order code', () => {
    expect(formatOrderCode('01JD0000000000000000ABCDEF')).toBe('#00ABCDEF');
  });
});

describe('zalo login state', () => {
  it('accepts each state and rejects a non-image QR', () => {
    expect(
      ZaloLoginStateSchema.parse({ state: 'QR_READY', qrImage: 'data:image/png;base64,AA' }),
    ).toEqual({
      state: 'QR_READY',
      qrImage: 'data:image/png;base64,AA',
    });
    expect(ZaloLoginStateSchema.safeParse({ state: 'QR_READY', qrImage: 'http://x' }).success).toBe(
      false,
    );
    expect(ZaloLoginStateSchema.safeParse({ state: 'FAILED', reason: 'nope' }).success).toBe(false);
  });

  it('record carries vendor + requester ids', () => {
    const record = {
      vendorId: '01JD0000000000000000000001',
      requestedById: '01JD0000000000000000000002',
      state: { state: 'PENDING' },
    };
    expect(ZaloLoginRecordSchema.parse(record)).toEqual(record);
    expect(ZaloLoginRecordSchema.safeParse({ ...record, vendorId: 'x' }).success).toBe(false);
  });
});

describe('zalo misc schemas', () => {
  it('message list query coerces limit and validates status', () => {
    expect(ZaloMessageListQuerySchema.parse({ limit: '5', status: 'SENT' })).toEqual({
      limit: 5,
      status: 'SENT',
    });
    expect(ZaloMessageListQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });

  it('checkout zaloOptIn defaults to false', () => {
    const base = {
      items: [{ variantId: '01JD0000000000000000000003', quantity: 1 }],
      addressId: '01JD0000000000000000000004',
      shippingMethodIds: ['01JD0000000000000000000005'],
      provider: 'VNPAY',
    };
    expect(CheckoutSchema.parse(base).zaloOptIn).toBe(false);
    expect(CheckoutSchema.parse({ ...base, zaloOptIn: true }).zaloOptIn).toBe(true);
    expect(CheckoutSchema.safeParse({ ...base, zaloOptIn: 'yes' }).success).toBe(false);
  });
});
