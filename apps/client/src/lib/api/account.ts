import {
  AddressSchema,
  MeResponseSchema,
  PresignResponseSchema,
  ReviewSchema,
  VendorApplicationMeSchema,
  type Address,
  type AddressInput,
  type AddressUpdate,
  type MeResponse,
  type PresignRequest,
  type PresignResponse,
  type ProfileUpdate,
  type Review,
  type ReviewCreateBody,
  type VendorApplicationCreate,
  type VendorApplicationMe,
} from '@repo/core';
import type { UploadDeps } from '../uploads';
import { xhrPut } from '../uploads';
import { browserApi } from './browser';
import { ApiError, errorCodeOf, parseResult } from './errors';

/**
 * Signed-in calls of the account area (`/account`, `/sell`, reviews). Every mutation takes the
 * `Idempotency-Key` of the user action, so a retry of the same submit replays the first result.
 */
/** `GET /v1/me/addresses` replies with a bare array of addresses. */
const AddressListSchema = {
  parse: (input: unknown): Address[] => {
    if (!Array.isArray(input)) throw new TypeError('Expected an address list');
    return input.map((item) => AddressSchema.parse(item));
  },
};

const idem = (key: string) => ({ 'Idempotency-Key': key });

// The generated request types have plain optional properties, while core schemas yield
// `T | undefined` (exactOptionalPropertyTypes): copy only the defined fields.
function profileBody(p: ProfileUpdate) {
  return {
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.primaryLocale !== undefined ? { primaryLocale: p.primaryLocale } : {}),
  };
}

function addressBody({ line2, ...rest }: AddressInput) {
  return { ...rest, ...(line2 !== undefined ? { line2 } : {}) };
}

function addressUpdateBody(a: AddressUpdate) {
  return {
    ...(a.recipientName !== undefined ? { recipientName: a.recipientName } : {}),
    ...(a.phone !== undefined ? { phone: a.phone } : {}),
    ...(a.line1 !== undefined ? { line1: a.line1 } : {}),
    ...(a.line2 !== undefined ? { line2: a.line2 } : {}),
    ...(a.ward !== undefined ? { ward: a.ward } : {}),
    ...(a.district !== undefined ? { district: a.district } : {}),
    ...(a.city !== undefined ? { city: a.city } : {}),
    ...(a.country !== undefined ? { country: a.country } : {}),
  };
}

function reviewBody({ body, ...rest }: ReviewCreateBody) {
  return { ...rest, ...(body !== undefined ? { body } : {}) };
}

export async function updateProfile(body: ProfileUpdate, key: string): Promise<MeResponse> {
  return parseResult(
    await browserApi().PATCH('/v1/me', { body: profileBody(body), headers: idem(key) }),
    MeResponseSchema,
  );
}

export async function listAddresses(): Promise<Address[]> {
  return parseResult(await browserApi().GET('/v1/me/addresses'), AddressListSchema);
}

export async function createAddress(body: AddressInput, key: string): Promise<Address> {
  return parseResult(
    await browserApi().POST('/v1/me/addresses', {
      body: addressBody(body),
      headers: idem(key),
    }),
    AddressSchema,
  );
}

export async function updateAddress(
  id: string,
  body: AddressUpdate,
  key: string,
): Promise<Address> {
  return parseResult(
    await browserApi().PATCH('/v1/me/addresses/{id}', {
      body: addressUpdateBody(body),
      params: { path: { id } },
      headers: idem(key),
    }),
    AddressSchema,
  );
}

export async function deleteAddress(id: string): Promise<void> {
  const result = await browserApi().DELETE('/v1/me/addresses/{id}', {
    params: { path: { id } },
  });
  if (!result.response.ok) throw new ApiError(result.response.status, errorCodeOf(result.error));
}

export async function setDefaultAddress(id: string, key: string): Promise<Address> {
  return parseResult(
    await browserApi().POST('/v1/me/addresses/{id}/default', {
      params: { path: { id } },
      headers: idem(key),
    }),
    AddressSchema,
  );
}

export async function getMyVendorApplications(): Promise<VendorApplicationMe> {
  return parseResult(
    await browserApi().GET('/v1/vendor-applications/me'),
    VendorApplicationMeSchema,
  );
}

/** Resolves once the application is stored (reply is the masked row — read `/me` afterwards). */
export async function submitVendorApplication(
  body: VendorApplicationCreate,
  key: string,
): Promise<void> {
  const result = await browserApi().POST('/v1/vendor-applications', {
    body,
    params: { header: idem(key) },
  });
  if (!result.response.ok) throw new ApiError(result.response.status, errorCodeOf(result.error));
}

export async function createReview(
  productId: string,
  body: ReviewCreateBody,
  key: string,
): Promise<Review> {
  return parseResult(
    await browserApi().POST('/v1/products/{id}/reviews', {
      body: reviewBody(body),
      params: { path: { id: productId }, header: idem(key) },
    }),
    ReviewSchema,
  );
}

async function presign(body: PresignRequest): Promise<PresignResponse> {
  return parseResult(
    await browserApi().POST('/v1/uploads/presign', { body }),
    PresignResponseSchema,
  );
}

/** Upload seams for `uploadKycFile` bound to the browser session. */
export const browserUploadDeps: UploadDeps<File> = { presign, put: xhrPut };
