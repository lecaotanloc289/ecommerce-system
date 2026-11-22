import { describe, expect, it } from 'vitest';
import {
  CancelCrmCampaignSchema,
  ConsentActionSchema,
  CrmCouponCodeSchema,
  CrmTagSchema,
  PlatformSettingsUpdateSchema,
  assertCrmCouponCode,
  deriveUnsubscribeToken,
  findLink,
  hashUnsubscribeToken,
  CreateCrmCampaignSchema,
  CreateCustomerNoteSchema,
  CrmAudienceFilterSchema,
  CrmCustomerListQuerySchema,
  CrmTemplateTextSchema,
  CRM_CAMPAIGN_AGGREGATE_TYPE,
  DomainError,
  NotificationSchema,
  OUTBOX_EVENT_SCHEMAS,
  ReplaceCustomerTagsSchema,
  ScheduleCrmCampaignSchema,
  UnsubscribeSchema,
  UpdateCrmAutomationSchema,
  UpdateVendorPreferenceSchema,
  assertCrmTemplate,
  classifyCustomer,
  messageKindOf,
  renderCrmTemplate,
} from '../src';

const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const T = { atRiskAfterDays: 60, lapsedAfterDays: 180, vipMinOrders: 3 };
const NOW = new Date('2026-11-23T00:00:00.000Z');
const daysAgo = (d: number): Date => new Date(NOW.getTime() - d * 86_400_000);

describe('classifyCustomer', () => {
  it.each([
    [1, 60, 'NEW'],
    [1, 61, 'AT_RISK'],
    [1, 180, 'AT_RISK'],
    [1, 181, 'LAPSED'],
    [2, 10, 'RETURNING'],
    [3, 10, 'VIP'],
    [5, 60, 'VIP'],
    [5, 61, 'AT_RISK'],
    [5, 181, 'LAPSED'],
    [1, 0, 'NEW'],
  ] as const)('orders=%i lastOrder=%i days ago -> %s', (orderCount, days, expected) => {
    expect(classifyCustomer({ orderCount, lastOrderAt: daysAgo(days) }, NOW, T)).toBe(expected);
  });

  it('accepts ISO strings', () => {
    expect(classifyCustomer({ orderCount: 2, lastOrderAt: daysAgo(1).toISOString() }, NOW, T)).toBe(
      'RETURNING',
    );
  });
});

describe('assertCrmTemplate', () => {
  it.each([
    'Xem https://x.vn nhé',
    'HTTP://X.VN',
    'Vào www.x.com ngay',
    'Ghé shop.vn/abc nhé',
    'Mua tại abc.com/x',
    'Truy cập shop.vn',
    'Xem {shopName}.com',
  ])('rejects link: %s', (text) => {
    expect(() => assertCrmTemplate(text)).toThrow(DomainError);
    try {
      assertCrmTemplate(text);
    } catch (e) {
      expect(e instanceof DomainError && e.code).toBe('crm.error.links-not-allowed');
    }
  });

  it.each(['Hi {phone}', '{ customerName }', '{CustomerName}'])(
    'rejects unknown placeholder: %s',
    (text) => {
      try {
        assertCrmTemplate(text);
        expect.unreachable();
      } catch (e) {
        expect(e instanceof DomainError && e.code).toBe('crm.error.unknown-placeholder');
      }
    },
  );

  it.each([
    'Cảm ơn {customerName} đã mua hàng tại {shopName}.',
    'Giảm 1.5 triệu cho đơn tiếp theo. Dùng mã {couponCode}.',
    'Xin chào bạn. Hẹn gặp lại.',
    'Đơn hàng đã giao xong.Cảm ơn bạn!',
    'Thanks for shopping. See you soon.',
  ])('accepts: %s', (text) => {
    expect(() => assertCrmTemplate(text)).not.toThrow();
  });
});

describe('renderCrmTemplate / messageKindOf', () => {
  it('fills every placeholder', () => {
    expect(
      renderCrmTemplate('Hi {customerName}, {shopName}: {couponCode}', {
        customerName: 'Minh',
        shopName: 'Shop A',
        couponCode: 'SALE10',
      }),
    ).toBe('Hi Minh, Shop A: SALE10');
  });

  it('renders empty without a coupon and does not re-scan values', () => {
    expect(
      renderCrmTemplate('{customerName}|{couponCode}|', {
        customerName: '{shopName}',
        shopName: 'S',
      }),
    ).toBe('{shopName}||');
  });

  it('maps automation kinds', () => {
    expect(messageKindOf('THANK_YOU')).toBe('SERVICE');
    expect(messageKindOf('REVIEW_REQUEST')).toBe('SERVICE');
    expect(messageKindOf('REORDER_REMINDER')).toBe('MARKETING');
  });
});

describe('crm schemas', () => {
  const audience = { segments: ['VIP'], tags: [], boughtProductIds: [], lastOrderWithinDays: null };

  it('CrmTemplateTextSchema', () => {
    expect(CrmTemplateTextSchema.parse('  Hi {customerName}  ')).toBe('Hi {customerName}');
    expect(CrmTemplateTextSchema.safeParse('see shop.vn').success).toBe(false);
    expect(CrmTemplateTextSchema.safeParse('   ').success).toBe(false);
    expect(CrmTemplateTextSchema.safeParse('a'.repeat(1001)).success).toBe(false);
  });

  it('CrmCustomerListQuerySchema', () => {
    expect(CrmCustomerListQuerySchema.parse({ segment: 'VIP', sort: 'last_order' }).limit).toBe(20);
    expect(CrmCustomerListQuerySchema.safeParse({ segment: 'GOLD' }).success).toBe(false);
  });

  it('ReplaceCustomerTagsSchema lowercases and rejects dupes / too many', () => {
    expect(ReplaceCustomerTagsSchema.parse({ tags: ['VIP', ' khach-quen '] }).tags).toEqual([
      'vip',
      'khach-quen',
    ]);
    expect(ReplaceCustomerTagsSchema.safeParse({ tags: ['a', 'A'] }).success).toBe(false);
    expect(
      ReplaceCustomerTagsSchema.safeParse({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })
        .success,
    ).toBe(false);
  });

  it('CreateCustomerNoteSchema', () => {
    expect(CreateCustomerNoteSchema.safeParse({ body: 'ok' }).success).toBe(true);
    expect(CreateCustomerNoteSchema.safeParse({ body: ' ' }).success).toBe(false);
  });

  it('UpdateCrmAutomationSchema', () => {
    const ok = {
      isEnabled: true,
      delayDays: 3,
      templateVi: null,
      templateEn: null,
      couponId: null,
    };
    expect(UpdateCrmAutomationSchema.safeParse(ok).success).toBe(true);
    expect(UpdateCrmAutomationSchema.safeParse({ ...ok, templateVi: 'www.x.com' }).success).toBe(
      false,
    );
  });

  it('CrmAudienceFilterSchema', () => {
    expect(CrmAudienceFilterSchema.safeParse(audience).success).toBe(true);
    expect(
      CrmAudienceFilterSchema.safeParse({ ...audience, segments: ['VIP', 'VIP'] }).success,
    ).toBe(false);
    expect(CrmAudienceFilterSchema.safeParse({ ...audience, lastOrderWithinDays: 0 }).success).toBe(
      false,
    );
  });

  it('CreateCrmCampaignSchema', () => {
    const ok = {
      name: 'Tet',
      audience,
      templateVi: 'Hi {customerName}',
      templateEn: null,
      couponId: null,
    };
    expect(CreateCrmCampaignSchema.safeParse(ok).success).toBe(true);
    expect(CreateCrmCampaignSchema.safeParse({ ...ok, name: '' }).success).toBe(false);
    expect(CreateCrmCampaignSchema.safeParse({ ...ok, templateVi: '{x}' }).success).toBe(false);
  });

  it('ScheduleCrmCampaignSchema', () => {
    expect(ScheduleCrmCampaignSchema.safeParse({ scheduledAt: null }).success).toBe(true);
    expect(
      ScheduleCrmCampaignSchema.safeParse({ scheduledAt: '2026-12-01T10:00:00+07:00' }).success,
    ).toBe(true);
    expect(ScheduleCrmCampaignSchema.safeParse({ scheduledAt: 'tomorrow' }).success).toBe(false);
  });

  it('CancelCrmCampaignSchema', () => {
    expect(CancelCrmCampaignSchema.safeParse({ reason: 'spam' }).success).toBe(true);
    expect(CancelCrmCampaignSchema.safeParse({ reason: 'x' }).success).toBe(false);
  });

  it('UpdateVendorPreferenceSchema needs a field', () => {
    expect(UpdateVendorPreferenceSchema.safeParse({ marketingOptIn: true }).success).toBe(true);
    expect(UpdateVendorPreferenceSchema.safeParse({}).success).toBe(false);
  });

  it('UnsubscribeSchema', () => {
    const token = 'A'.repeat(43);
    expect(UnsubscribeSchema.safeParse({ token, scope: 'ALL' }).success).toBe(true);
    expect(UnsubscribeSchema.safeParse({ token: 'short', scope: 'ALL' }).success).toBe(false);
    expect(UnsubscribeSchema.safeParse({ token, scope: 'NONE' }).success).toBe(false);
  });

  it('NotificationSchema', () => {
    const ok = {
      id: ULID,
      vendorId: null,
      title: 't',
      body: 'b',
      linkPath: null,
      readAt: null,
      createdAt: '2026-11-23T00:00:00.000Z',
    };
    expect(NotificationSchema.safeParse(ok).success).toBe(true);
    expect(NotificationSchema.safeParse({ ...ok, id: 'x' }).success).toBe(false);
  });

  it('outbox event crm.campaign.scheduled', () => {
    expect(CRM_CAMPAIGN_AGGREGATE_TYPE).toBe('crm-campaign');
    const s = OUTBOX_EVENT_SCHEMAS['crm.campaign.scheduled'];
    expect(s.safeParse({ campaignId: ULID, vendorId: ULID }).success).toBe(true);
    expect(s.safeParse({ campaignId: ULID }).success).toBe(false);
  });
});

const EXPECTED_TOKEN = 'bkasKKPiDaj1knNQepzu84H2zJHdy275iQwo47jEtRM';

const codeOf = (fn: () => void): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : 'other';
  }
  return undefined;
};

describe('link detection hardening', () => {
  it.each([
    'HTTPS://X.VN',
    'bit.ly/a',
    't.me/x',
    'youtu.be/x',
    'x。com',
    'ｈｔｔｐｓ：／／ａ．ｃｏ',
    'x.c​om',
    '192.168.0.1',
    'zalo://x',
    '//evil.com',
    'SHOP.VN',
    'mailto:a@b.vn',
    'tg:resolve?domain=x',
    'liên hệ a@b.com',
    'ftp://x',
  ])('rejects %s', (text) => {
    expect(codeOf(() => assertCrmTemplate(text))).toBe('crm.error.links-not-allowed');
  });

  it.each(['ngay.Top', 'Order.Shop now', '1.Shop', '199.000đ', '10.30', '1.5kg', 'Giá 1.299.000đ'])(
    'accepts %s',
    (text) => {
      expect(codeOf(() => assertCrmTemplate(text))).toBeUndefined();
    },
  );

  it('reports the matched substring', () => {
    expect(findLink('xem bit.ly/a nhé')).toBe('bit.ly');
    try {
      assertCrmTemplate('xem bit.ly/a');
    } catch (e) {
      expect(e instanceof DomainError && e.params).toEqual({ match: 'bit.ly' });
    }
  });
});

describe('renderCrmTemplate link guard', () => {
  it('throws when shopName or couponCode carry a link, not customerName', () => {
    expect(
      codeOf(() => renderCrmTemplate('{shopName}', { customerName: 'A', shopName: 'bit.ly/x' })),
    ).toBe('crm.error.links-not-allowed');
    expect(
      codeOf(() =>
        renderCrmTemplate('{couponCode}', {
          customerName: 'A',
          shopName: 'S',
          couponCode: 'www.x.com',
        }),
      ),
    ).toBe('crm.error.links-not-allowed');
    expect(renderCrmTemplate('{customerName}', { customerName: 'a.com', shopName: 'S' })).toBe(
      'a.com',
    );
  });
});

describe('coupon code', () => {
  it('validates charset', () => {
    expect(CrmCouponCodeSchema.safeParse('SALE-10_A').success).toBe(true);
    expect(CrmCouponCodeSchema.safeParse('sale10').success).toBe(false);
    expect(CrmCouponCodeSchema.safeParse('A.B').success).toBe(false);
    expect(codeOf(() => assertCrmCouponCode('AB'))).toBe('crm.error.coupon-invalid');
    expect(codeOf(() => assertCrmCouponCode('SALE10'))).toBeUndefined();
  });
});

describe('unsubscribe token', () => {
  it('is deterministic, 43 base64url chars, fixed vector', async () => {
    const token = await deriveUnsubscribeToken('secret', 'user1', 'vendor1');
    expect(token).toBe(EXPECTED_TOKEN);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await deriveUnsubscribeToken('secret', 'user1', 'vendor2')).not.toBe(token);
    expect(UnsubscribeSchema.safeParse({ token, scope: 'ALL' }).success).toBe(true);
  });

  it('hashes with sha256 hex', async () => {
    expect(await hashUnsubscribeToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('review fixes', () => {
  it('CrmTagSchema normalizes and rejects control chars', () => {
    expect(CrmTagSchema.parse(' Café ')).toBe('café');
    expect(CrmTagSchema.safeParse('a​b').success).toBe(false);
    expect(CrmTagSchema.safeParse('a\u0000b').success).toBe(false);
  });

  it('list query tag + opaque cursor', () => {
    expect(CrmCustomerListQuerySchema.parse({ tag: ' VIP ', cursor: 'abc|123' })).toMatchObject({
      tag: 'vip',
      cursor: 'abc|123',
    });
    expect(CrmCustomerListQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
  });

  it('audience dedupes tags and products', () => {
    const base = { segments: [], tags: [], boughtProductIds: [], lastOrderWithinDays: null };
    expect(CrmAudienceFilterSchema.safeParse({ ...base, tags: ['a', 'A'] }).success).toBe(false);
    expect(
      CrmAudienceFilterSchema.safeParse({ ...base, boughtProductIds: [ULID, ULID] }).success,
    ).toBe(false);
  });

  it('notification linkPath / lengths', () => {
    const ok = {
      id: ULID,
      vendorId: null,
      title: 't',
      body: 'b',
      linkPath: '/shop/a',
      readAt: null,
      createdAt: '2026-11-23T00:00:00.000Z',
    };
    expect(NotificationSchema.safeParse(ok).success).toBe(true);
    expect(NotificationSchema.safeParse({ ...ok, linkPath: '//evil.com' }).success).toBe(false);
    expect(NotificationSchema.safeParse({ ...ok, linkPath: 'https://x.vn' }).success).toBe(false);
    expect(NotificationSchema.safeParse({ ...ok, title: 'x'.repeat(201) }).success).toBe(false);
  });

  it('automation delayDays <= 180', () => {
    const ok = {
      isEnabled: true,
      delayDays: 180,
      templateVi: null,
      templateEn: null,
      couponId: null,
    };
    expect(UpdateCrmAutomationSchema.safeParse(ok).success).toBe(true);
    expect(UpdateCrmAutomationSchema.safeParse({ ...ok, delayDays: 181 }).success).toBe(false);
  });

  it('classifyCustomer rejects invalid input', () => {
    expect(codeOf(() => classifyCustomer({ orderCount: 1, lastOrderAt: 'nope' }, NOW, T))).toBe(
      'common.error.internal',
    );
    expect(
      codeOf(() =>
        classifyCustomer({ orderCount: 1, lastOrderAt: NOW }, NOW, { ...T, atRiskAfterDays: 180 }),
      ),
    ).toBe('common.error.internal');
  });

  it('platform settings crm fields', () => {
    expect(PlatformSettingsUpdateSchema.safeParse({ crmAtRiskAfterDays: 30 }).success).toBe(true);
    expect(
      PlatformSettingsUpdateSchema.safeParse({ crmAtRiskAfterDays: 90, crmLapsedAfterDays: 90 })
        .success,
    ).toBe(false);
    expect(PlatformSettingsUpdateSchema.safeParse({ crmVipMinOrders: 0 }).success).toBe(false);
    expect(PlatformSettingsUpdateSchema.safeParse({ crmLapsedAfterDays: 3651 }).success).toBe(
      false,
    );
  });

  it('ConsentAction', () => {
    expect(ConsentActionSchema.options).toEqual([
      'MARKETING_OPT_IN',
      'MARKETING_OPT_OUT',
      'SERVICE_OPT_OUT',
      'SERVICE_OPT_IN',
    ]);
  });
});
