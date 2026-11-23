import type { PresignRequest, PresignResponse } from '@repo/core';

/** Mirrors the API's `kyc` rules (`server/CLAUDE.md` "Storage / uploads"): checked here first for fast feedback. */
export const KYC_MAX_BYTES = 10 * 1024 * 1024;
export const KYC_ALLOWED_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];
/** `accept` attribute of the file input. */
export const KYC_ACCEPT = KYC_ALLOWED_TYPES.join(',');

export type FileProblem = 'type' | 'size' | 'empty';

/** What the upload needs from a `File`. */
export interface UploadableFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

/** First problem with a KYC file, or null when the API would accept it. */
export function checkKycFile(file: Pick<UploadableFile, 'type' | 'size'>): FileProblem | null {
  if (!KYC_ALLOWED_TYPES.includes(file.type.toLowerCase())) return 'type';
  if (file.size <= 0) return 'empty';
  if (file.size > KYC_MAX_BYTES) return 'size';
  return null;
}

/** Network seams, injected so the flow is testable without a browser. */
export interface UploadDeps<F extends UploadableFile = UploadableFile> {
  /** `POST /v1/uploads/presign` (parsed). Throws `ApiError` on a non-2xx reply. */
  presign(body: PresignRequest): Promise<PresignResponse>;
  /** `PUT` the file to the presigned URL with the returned headers; `onProgress` gets 0..1. */
  put(
    target: { url: string; headers: Readonly<Record<string, string>> },
    file: F,
    onProgress: (fraction: number) => void,
  ): Promise<void>;
}

/** The file never left the browser (validation) or the storage PUT failed. */
export class UploadError extends Error {
  constructor(
    readonly kind: 'invalid-file' | 'put-failed',
    readonly problem: FileProblem | null = null,
  ) {
    super(kind === 'invalid-file' ? `Invalid file (${problem ?? 'unknown'})` : 'Upload failed');
    this.name = 'UploadError';
  }
}

/**
 * Upload one KYC document: validate type/size locally (no API call for a bad file), presign,
 * PUT to storage, resolve to the object `key` to send with the application.
 */
export async function uploadKycFile<F extends UploadableFile>(
  file: F,
  deps: UploadDeps<F>,
  onProgress: (fraction: number) => void = () => {},
): Promise<string> {
  const problem = checkKycFile(file);
  if (problem) throw new UploadError('invalid-file', problem);
  const target = await deps.presign({
    purpose: 'kyc',
    contentType: file.type.toLowerCase(),
    size: file.size,
  });
  try {
    await deps.put({ url: target.url, headers: target.headers }, file, onProgress);
  } catch {
    throw new UploadError('put-failed');
  }
  onProgress(1);
  return target.key;
}

/** Headers a browser sets itself (XHR ignores / rejects them). */
const FORBIDDEN_HEADERS = new Set(['content-length', 'host']);

/** Headers to forward to the storage PUT: the presigned ones minus those the browser owns. */
export function putHeaders(headers: Readonly<Record<string, string>>): [string, string][] {
  return Object.entries(headers).filter(([name]) => !FORBIDDEN_HEADERS.has(name.toLowerCase()));
}

/** Browser `put`: XMLHttpRequest, because `fetch` cannot report upload progress. */
export function xhrPut(
  target: { url: string; headers: Readonly<Record<string, string>> },
  file: Blob,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.url);
    for (const [name, value] of putHeaders(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage replied ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onabort = () => reject(new Error('Aborted'));
    xhr.send(file);
  });
}
