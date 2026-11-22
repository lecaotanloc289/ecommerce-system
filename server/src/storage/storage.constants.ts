import type { UploadPurpose } from '@repo/core';

/** Presigned PUT lifetime in seconds (roadmap D13: 5 minutes). */
export const PRESIGN_PUT_TTL_SECONDS = 5 * 60;
/** KYC documents are read by platform staff through a very short-lived link. */
export const PRESIGN_GET_TTL_SECONDS = 60;
/** Per-file ceiling for every purpose (the core schema allows up to 20 MB; the server is stricter). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type StorageBucketKind = 'kyc' | 'media';

export interface PurposeRule {
  bucket: StorageBucketKind;
  /** Allowed content types → file extension used in the object key. */
  extensions: Readonly<Record<string, string>>;
}

const IMAGES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

export const PURPOSE_RULES: Readonly<Record<UploadPurpose, PurposeRule>> = {
  kyc: { bucket: 'kyc', extensions: { ...IMAGES, 'application/pdf': 'pdf' } },
  'product-image': { bucket: 'media', extensions: IMAGES },
  'vendor-logo': { bucket: 'media', extensions: IMAGES },
};

/** Every extension the server ever writes (used to validate keys on the way back in). */
export const KEY_EXTENSIONS = ['jpg', 'png', 'webp', 'pdf'] as const;
