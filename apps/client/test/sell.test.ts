import { describe, expect, it, vi } from 'vitest';
import { VendorApplicationSchema, type VendorApplication } from '@repo/core';
import { vendorPortalUrl } from '../src/lib/api/config';
import {
  KYC_MAX_BYTES,
  UploadError,
  checkKycFile,
  putHeaders,
  uploadKycFile,
  type UploadDeps,
} from '../src/lib/uploads';
import {
  EMPTY_APPLICATION_FORM,
  applicationView,
  canApply,
  validateApplication,
} from '../src/lib/vendor-application';

const ULID = (n: number) => `01JD${String(n).padStart(22, '0')}`;

function application(n: number, overrides: Partial<VendorApplication> = {}): VendorApplication {
  return VendorApplicationSchema.parse({
    id: ULID(n),
    applicantId: ULID(900),
    status: 'PENDING',
    businessLicenseKey: `kyc/${ULID(900)}/${ULID(n)}.pdf`,
    taxId: '0312345678',
    nationalIdNumber: '079123456789',
    nationalIdKey: `kyc/${ULID(900)}/${ULID(n + 50)}.png`,
    bankName: 'Vietcombank',
    bankAccountNumber: '0123456789',
    accountHolder: 'NGUYEN VAN A',
    bankVerified: false,
    reviewedAt: null,
    rejectReason: null,
    createdAt: '2026-11-20T08:00:00.000Z',
    ...overrides,
  });
}

describe('checkKycFile', () => {
  it('accepts jpeg / png / webp / pdf up to 10 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(checkKycFile({ type, size: 1024 })).toBeNull();
    }
    expect(checkKycFile({ type: 'image/png', size: KYC_MAX_BYTES })).toBeNull();
  });

  it('rejects other types, empty and oversized files', () => {
    expect(checkKycFile({ type: 'image/gif', size: 10 })).toBe('type');
    expect(checkKycFile({ type: '', size: 10 })).toBe('type');
    expect(checkKycFile({ type: 'application/pdf', size: 0 })).toBe('empty');
    expect(checkKycFile({ type: 'application/pdf', size: KYC_MAX_BYTES + 1 })).toBe('size');
  });
});

describe('uploadKycFile', () => {
  const file = { name: 'license.pdf', type: 'application/pdf', size: 2048 };
  const target = {
    url: 'http://s3.test/kyc/key',
    key: 'kyc/user/abc.pdf',
    headers: { 'content-type': 'application/pdf' },
    expiresAt: '2026-11-23T10:05:00.000Z',
  };

  function deps(): UploadDeps & {
    presign: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  } {
    return {
      presign: vi.fn(async () => target),
      put: vi.fn(async (_t, _f, onProgress: (n: number) => void) => onProgress(0.5)),
    };
  }

  it('presigns (purpose kyc, content type, size), PUTs with the returned headers and resolves the key', async () => {
    const d = deps();
    const progress: number[] = [];
    const key = await uploadKycFile(file, d, (p) => progress.push(p));

    expect(key).toBe('kyc/user/abc.pdf');
    expect(d.presign).toHaveBeenCalledWith({
      purpose: 'kyc',
      contentType: 'application/pdf',
      size: 2048,
    });
    expect(d.put).toHaveBeenCalledWith(
      { url: target.url, headers: target.headers },
      file,
      expect.any(Function),
    );
    expect(progress).toEqual([0.5, 1]);
  });

  it('rejects a wrong type or size BEFORE calling the API', async () => {
    const d = deps();
    await expect(uploadKycFile({ ...file, type: 'text/plain' }, d)).rejects.toMatchObject({
      kind: 'invalid-file',
      problem: 'type',
    });
    await expect(uploadKycFile({ ...file, size: KYC_MAX_BYTES + 1 }, d)).rejects.toMatchObject({
      kind: 'invalid-file',
      problem: 'size',
    });
    expect(d.presign).not.toHaveBeenCalled();
    expect(d.put).not.toHaveBeenCalled();
  });

  it('turns a failed storage PUT into an UploadError and never returns a key', async () => {
    const d = deps();
    d.put.mockRejectedValueOnce(new Error('Storage replied 403'));
    const error = await uploadKycFile(file, d).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect(error).toMatchObject({ kind: 'put-failed' });
  });

  it('lets a presign API error through untouched (translated by the caller)', async () => {
    const d = deps();
    const apiError = new Error('too large');
    d.presign.mockRejectedValueOnce(apiError);
    await expect(uploadKycFile(file, d)).rejects.toBe(apiError);
    expect(d.put).not.toHaveBeenCalled();
  });
});

describe('putHeaders', () => {
  it('drops headers the browser owns (content-length, host) and keeps the rest', () => {
    expect(
      putHeaders({
        'Content-Length': '10',
        host: 's3',
        'content-type': 'image/png',
        'x-amz-meta': '1',
      }),
    ).toEqual([
      ['content-type', 'image/png'],
      ['x-amz-meta', '1'],
    ]);
  });
});

describe('applicationView', () => {
  it('no applications → none, form available', () => {
    const view = applicationView({ latest: null, history: [] });
    expect(view).toEqual({ kind: 'none', history: [] });
    expect(canApply(view)).toBe(true);
  });

  it('maps the latest status and lists only older rows as history', () => {
    const rejected = application(1, { status: 'REJECTED', rejectReason: 'Blurry document' });
    const pending = application(2);
    const view = applicationView({ latest: pending, history: [pending, rejected] });
    expect(view.kind).toBe('pending');
    expect(view.history.map((a) => a.id)).toEqual([rejected.id]);
    expect(canApply(view)).toBe(false);
  });

  it('REJECTED allows re-applying and keeps the reason; APPROVED does not', () => {
    const rejected = application(1, { status: 'REJECTED', rejectReason: 'Blurry document' });
    const view = applicationView({ latest: rejected, history: [rejected] });
    expect(view).toMatchObject({
      kind: 'rejected',
      application: { rejectReason: 'Blurry document' },
    });
    expect(canApply(view)).toBe(true);

    const approved = application(3, { status: 'APPROVED' });
    const approvedView = applicationView({ latest: approved, history: [approved, rejected] });
    expect(approvedView.kind).toBe('approved');
    expect(canApply(approvedView)).toBe(false);
  });
});

describe('validateApplication', () => {
  const ok = {
    ...EMPTY_APPLICATION_FORM,
    businessLicenseKey: 'kyc/u/a.pdf',
    nationalIdKey: 'kyc/u/b.png',
    taxId: '0312345678',
    nationalIdNumber: '079123456789',
    bankName: 'Vietcombank',
    bankAccountNumber: '0123456789',
    accountHolder: 'NGUYEN VAN A',
  };

  it('accepts a complete application', () => {
    expect(validateApplication(ok)).toEqual({ ok: true, value: ok });
  });

  it('requires both uploaded documents and flags bad fields with translatable keys', () => {
    const result = validateApplication({
      ...ok,
      businessLicenseKey: '',
      nationalIdKey: '',
      taxId: '',
      bankAccountNumber: '12-34',
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        businessLicenseKey: 'form.required',
        nationalIdKey: 'form.required',
        taxId: 'form.required',
        bankAccountNumber: 'form.invalid',
      },
    });
  });

  it('refuses the same file used for both documents', () => {
    expect(validateApplication({ ...ok, nationalIdKey: ok.businessLicenseKey })).toEqual({
      ok: false,
      errors: { nationalIdKey: 'form.invalid' },
    });
  });
});

describe('vendorPortalUrl', () => {
  it('appends /vendor to the configured admin origin (trailing slash tolerated)', () => {
    expect(vendorPortalUrl('https://admin.elma.vn/')).toBe('https://admin.elma.vn/vendor');
  });

  it('falls back to the local admin app outside production', () => {
    expect(vendorPortalUrl('')).toBe('http://localhost:5173/vendor');
  });
});
