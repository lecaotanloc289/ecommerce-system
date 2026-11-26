import { describe, expect, it } from 'vitest';
import { maskAuthorName } from '../src/schemas/review';

describe('maskAuthorName', () => {
  it('keeps the first word and the initial of the last word', () => {
    expect(maskAuthorName('Nguyễn Văn An')).toBe('Nguyễn A.');
    expect(maskAuthorName('  Jane   Mary   doe ')).toBe('Jane D.');
    expect(maskAuthorName('Lê Đức')).toBe('Lê Đ.');
  });

  it('leaves a single word unchanged and blanks become *', () => {
    expect(maskAuthorName('Alice')).toBe('Alice');
    expect(maskAuthorName('  Alice ')).toBe('Alice');
    expect(maskAuthorName('   ')).toBe('*');
    expect(maskAuthorName('')).toBe('*');
  });
});
