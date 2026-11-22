import type { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DomainError } from '@repo/core';
import { StorageService, type StorageOwner } from '../../src/storage/storage.service';
import { testEnv } from '../helpers';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const presigner = jest.mocked(getSignedUrl);
const USER = '01J9ZQ4V6N5X8Y7W3T2R1P0M9K';
const OTHER_USER = '01J9ZQ4V6N5X8Y7W3T2R1P0M9L';
const VENDOR = '01J9ZQ4V6N5X8Y7W3T2R1P0VND';
const ULID = '01J9ZQ4V6N5X8Y7W3T2R1P0M9A';
const userOwner: StorageOwner = { type: 'user', userId: USER };
const vendorOwner: StorageOwner = { type: 'vendor', vendorId: VENDOR };

function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'not-a-domain-error';
  }
  return undefined;
}

describe('StorageService', () => {
  const env = testEnv({ MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com/' });
  const s3 = {} as S3Client;
  let storage: StorageService;

  beforeEach(() => {
    presigner.mockReset().mockResolvedValue('https://s3.example.com/signed');
    storage = new StorageService(env, s3);
  });

  describe('presignPut', () => {
    it('issues a kyc key in the private bucket, bound to content type and length', async () => {
      const res = await storage.presignPut('kyc', userOwner, 'application/pdf', 1234);

      expect(res.key).toMatch(new RegExp(`^kyc/${USER}/[0-9A-HJKMNP-TV-Z]{26}\\.pdf$`));
      expect(res.headers).toEqual({ 'Content-Type': 'application/pdf' });
      expect(res.url).toBe('https://s3.example.com/signed');
      expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

      const [, command, options] = presigner.mock.calls[0] ?? [];
      expect(command?.input).toMatchObject({
        Bucket: 'kyc',
        Key: res.key,
        ContentType: 'application/pdf',
        ContentLength: 1234,
      });
      expect(options).toMatchObject({ expiresIn: 300 });
      expect(options?.signableHeaders).toEqual(new Set(['content-type', 'content-length']));
    });

    it.each(['product-image', 'vendor-logo'] as const)(
      'issues a %s key under the vendor prefix in the media bucket',
      async (purpose) => {
        const res = await storage.presignPut(purpose, vendorOwner, 'image/webp', 10);
        expect(res.key).toMatch(
          new RegExp(`^media/vendors/${VENDOR}/[0-9A-HJKMNP-TV-Z]{26}\\.webp$`),
        );
        expect(presigner.mock.calls[0]?.[1].input).toMatchObject({ Bucket: 'media' });
      },
    );

    it('rejects content types outside the purpose allow-list', async () => {
      await expect(
        storage.presignPut('product-image', vendorOwner, 'application/pdf', 10),
      ).rejects.toMatchObject({ code: 'upload.error.content-type-not-allowed' });
      await expect(storage.presignPut('kyc', userOwner, 'image/gif', 10)).rejects.toMatchObject({
        code: 'upload.error.content-type-not-allowed',
      });
      expect(presigner).not.toHaveBeenCalled();
    });

    it('rejects sizes above 10 MB but accepts exactly 10 MB', async () => {
      await expect(
        storage.presignPut('kyc', userOwner, 'image/png', 10 * 1024 * 1024 + 1),
      ).rejects.toMatchObject({ code: 'upload.error.too-large' });
      await expect(
        storage.presignPut('kyc', userOwner, 'image/png', 10 * 1024 * 1024),
      ).resolves.toBeDefined();
    });

    it('refuses an owner type that does not match the purpose', async () => {
      await expect(storage.presignPut('kyc', vendorOwner, 'image/png', 10)).rejects.toMatchObject({
        code: 'upload.error.invalid-key',
      });
      await expect(
        storage.presignPut('product-image', userOwner, 'image/png', 10),
      ).rejects.toMatchObject({ code: 'upload.error.invalid-key' });
    });
  });

  describe('assertOwnedKey', () => {
    it('accepts keys issued for the same owner', () => {
      const kyc = `kyc/${USER}/${ULID}.jpg`;
      const media = `media/vendors/${VENDOR}/${ULID}.png`;
      expect(storage.assertOwnedKey(kyc, userOwner)).toBe(kyc);
      expect(storage.assertOwnedKey(media, vendorOwner)).toBe(media);
    });

    it.each([
      ['another user', `kyc/${OTHER_USER}/${ULID}.jpg`, userOwner],
      ['a vendor key presented by a user', `media/vendors/${VENDOR}/${ULID}.jpg`, userOwner],
      ['a kyc key presented by a vendor', `kyc/${USER}/${ULID}.jpg`, vendorOwner],
      ['another vendor', `media/vendors/${VENDOR}X/${ULID}.jpg`, vendorOwner],
      ['path traversal', `kyc/${USER}/../${OTHER_USER}/${ULID}.jpg`, userOwner],
      ['dot segment', `kyc/${USER}/./${ULID}.jpg`, userOwner],
      ['leading slash', `/kyc/${USER}/${ULID}.jpg`, userOwner],
      ['extra nesting', `kyc/${USER}/x/${ULID}.jpg`, userOwner],
      ['a non-ULID name', `kyc/${USER}/evil.jpg`, userOwner],
      ['a pdf under media', `media/vendors/${VENDOR}/${ULID}.pdf`, vendorOwner],
      ['an unknown extension', `kyc/${USER}/${ULID}.exe`, userOwner],
      ['an unknown prefix', `other/${USER}/${ULID}.jpg`, userOwner],
      ['a prefix-only owner', `kyc/${USER.slice(0, 10)}/${ULID}.jpg`, userOwner],
      ['an empty key', '', userOwner],
    ])('rejects %s', (_label, key, owner) => {
      expect(errorCodeOf(() => storage.assertOwnedKey(key, owner))).toBe(
        'upload.error.invalid-key',
      );
    });
  });

  describe('presignGet', () => {
    it('signs a 60s GET on the kyc bucket', async () => {
      const url = await storage.presignGet(`kyc/${USER}/${ULID}.pdf`);
      expect(url).toBe('https://s3.example.com/signed');
      const [, command, options] = presigner.mock.calls[0] ?? [];
      expect(command?.input).toMatchObject({ Bucket: 'kyc', Key: `kyc/${USER}/${ULID}.pdf` });
      expect(options).toMatchObject({ expiresIn: 60 });
    });

    it('refuses media and malformed keys', () => {
      expect(
        errorCodeOf(() => void storage.presignGet(`media/vendors/${VENDOR}/${ULID}.png`)),
      ).toBe('upload.error.invalid-key');
      expect(errorCodeOf(() => void storage.presignGet('kyc/../x'))).toBe(
        'upload.error.invalid-key',
      );
    });
  });

  describe('publicUrl', () => {
    it('joins the public base URL and the media key', () => {
      const key = `media/vendors/${VENDOR}/${ULID}.png`;
      expect(storage.publicUrl(key)).toBe(`https://cdn.example.com/${key}`);
    });

    it('refuses kyc keys', () => {
      expect(errorCodeOf(() => storage.publicUrl(`kyc/${USER}/${ULID}.png`))).toBe(
        'upload.error.invalid-key',
      );
    });
  });
});
