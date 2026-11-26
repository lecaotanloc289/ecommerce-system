import { pickSlug } from '../../src/orders/order-view';

describe('pickSlug', () => {
  const translations = [
    { locale: 'VI' as const, slug: 'ao-thun' },
    { locale: 'EN' as const, slug: 't-shirt' },
  ];

  it('prefers the wanted locale', () => {
    expect(pickSlug(translations, 'EN')).toBe('t-shirt');
    expect(pickSlug(translations, 'VI')).toBe('ao-thun');
  });

  it('falls back to vi, then to any translation, then null', () => {
    expect(pickSlug([{ locale: 'VI', slug: 'ao-thun' }], 'EN')).toBe('ao-thun');
    expect(pickSlug([{ locale: 'EN', slug: 't-shirt' }], 'VI')).toBe('t-shirt');
    expect(pickSlug([], 'VI')).toBeNull();
  });
});
