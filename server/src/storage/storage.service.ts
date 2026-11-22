import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  type PresignResponse,
  type UploadKey,
  UploadKeySchema,
  type UploadPurpose,
} from '@repo/core';
import { ulid } from 'ulid';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import {
  KEY_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  PRESIGN_GET_TTL_SECONDS,
  PRESIGN_PUT_TTL_SECONDS,
  PURPOSE_RULES,
  type StorageBucketKind,
} from './storage.constants';

/** Who may reference an uploaded key: a user (KYC) or a vendor (media). Always taken from `req.user`. */
export type StorageOwner = { type: 'user'; userId: string } | { type: 'vendor'; vendorId: string };

export const S3_CLIENT = Symbol('S3_CLIENT');

const KEY_PATTERN = new RegExp(
  `^(?:kyc/([A-Za-z0-9_-]+)|media/vendors/([A-Za-z0-9_-]+))/[0-9A-HJKMNP-TV-Z]{26}\\.(?:${KEY_EXTENSIONS.join('|')})$`,
);

/** Builds the S3 client (lazy: nothing connects until the first request). */
export function createS3Client(env: Env): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    // Presigned URLs must not carry extra checksum query params the browser cannot satisfy.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * Presigned-URL storage (roadmap D13). KYC documents live in the private `kyc` bucket and are
 * read only through short-lived presigned GETs; product images / logos live in the public `media`
 * bucket. Object keys embed the owner (`kyc/{userId}/…`, `media/vendors/{vendorId}/…`) and
 * `assertOwnedKey` must be called before a key echoed by a client is persisted.
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
  ) {}

  /**
   * Presigned PUT bound to the exact Content-Type and Content-Length (both are signed headers, so
   * S3 rejects an upload whose type or byte size differs from what was validated here). The client
   * must send `headers` verbatim and a body of exactly `size` bytes.
   */
  async presignPut(
    purpose: UploadPurpose,
    owner: StorageOwner,
    contentType: string,
    size: number,
  ): Promise<PresignResponse> {
    const rule = PURPOSE_RULES[purpose];
    const extension = rule.extensions[contentType];
    if (!extension) throw new DomainError('upload.error.content-type-not-allowed', { purpose });
    if (size > MAX_UPLOAD_BYTES) {
      throw new DomainError('upload.error.too-large', { maxBytes: MAX_UPLOAD_BYTES });
    }

    const key = this.newKey(purpose, owner, extension);
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucketName(rule.bucket),
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      {
        expiresIn: PRESIGN_PUT_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      url,
      key,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + PRESIGN_PUT_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Short-lived GET link for a KYC document. Authorisation (platform staff) is the caller's job. */
  presignGet(key: string): Promise<string> {
    if (!key.startsWith('kyc/') || !UploadKeySchema.safeParse(key).success) {
      throw new DomainError('upload.error.invalid-key');
    }
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucketName('kyc'), Key: key }),
      { expiresIn: PRESIGN_GET_TTL_SECONDS },
    );
  }

  /** Public URL of a `media/…` object. */
  publicUrl(key: string): string {
    if (!key.startsWith('media/') || !UploadKeySchema.safeParse(key).success) {
      throw new DomainError('upload.error.invalid-key');
    }
    return `${this.env.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`;
  }

  /**
   * Throws `upload.error.invalid-key` unless `key` is a well-formed key this server issued for
   * `owner` (rejects `..`, foreign owner prefixes, wrong shape). Returns the validated key.
   */
  assertOwnedKey(key: string, owner: StorageOwner): UploadKey {
    const parsed = UploadKeySchema.safeParse(key);
    const match = parsed.success ? KEY_PATTERN.exec(parsed.data) : null;
    const keyOwner = owner.type === 'user' ? match?.[1] : match?.[2];
    const expected = owner.type === 'user' ? owner.userId : owner.vendorId;
    if (!parsed.success || !match || !keyOwner || keyOwner !== expected) {
      throw new DomainError('upload.error.invalid-key');
    }
    return parsed.data;
  }

  private newKey(purpose: UploadPurpose, owner: StorageOwner, extension: string): string {
    if (purpose === 'kyc') {
      if (owner.type !== 'user') throw new DomainError('upload.error.invalid-key');
      return `kyc/${owner.userId}/${ulid()}.${extension}`;
    }
    if (owner.type !== 'vendor') throw new DomainError('upload.error.invalid-key');
    return `media/vendors/${owner.vendorId}/${ulid()}.${extension}`;
  }

  private bucketName(kind: StorageBucketKind): string {
    return kind === 'kyc' ? this.env.S3_BUCKET_KYC : this.env.S3_BUCKET_MEDIA;
  }
}
