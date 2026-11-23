import type { UploadPurpose } from '@repo/core';
import type { ApiClient } from '@repo/sdk';
import { ApiError, unwrap } from './api-error';

/**
 * Presigned upload: `POST /v1/uploads/presign` → `PUT` the bytes with the returned headers (S3
 * enforces content-type + exact size) → the object `key`, which later requests echo back
 * (product images, logo). The PUT is a cross-origin storage request: no cookies, no bearer token.
 */
export async function uploadFile(
  api: ApiClient,
  file: File,
  purpose: UploadPurpose,
  putFile: typeof fetch = (input, init) => fetch(input, init),
): Promise<string> {
  const presign = await unwrap(
    api.POST('/v1/uploads/presign', {
      body: { purpose, contentType: file.type, size: file.size },
    }),
  );
  const response = await putFile(presign.url, {
    method: 'PUT',
    headers: presign.headers,
    body: file,
    credentials: 'omit',
  });
  if (!response.ok) {
    // S3 answers 403 when the signed content-type / length does not match the declared one.
    const code =
      response.status === 403 ? 'upload.error.content-type-not-allowed' : 'common.error.internal';
    throw new ApiError(response.status, code);
  }
  return presign.key;
}
