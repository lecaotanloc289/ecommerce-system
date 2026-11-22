import { Global, Module, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from 'nestjs-zod';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { DomainErrorFilter } from '../../src/common/domain-error.filter';
import { ENV } from '../../src/config/config.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { REDIS } from '../../src/redis/redis.module';
import { StorageModule } from '../../src/storage/storage.module';
import { testEnv } from '../helpers';

const USER = '01J9ZQ4V6N5X8Y7W3T2R1P0M9K';
const VENDOR = '01J9ZQ4V6N5X8Y7W3T2R1P0VND';

/** Reads the caller from `x-test-user` (JSON) instead of verifying a JWT; RolesGuard stays real. */
class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const raw = request.headers['x-test-user'];
    if (typeof raw !== 'string') return false;
    request.user = JSON.parse(raw) as NonNullable<FastifyRequest['user']>;
    return true;
  }
}

@Global()
@Module({
  providers: [
    { provide: ENV, useValue: testEnv() },
    { provide: PrismaService, useValue: { client: {} } },
    { provide: REDIS, useValue: {} },
  ],
  exports: [ENV, PrismaService, REDIS],
})
class TestInfraModule {}

const asUser = (roles: string[], vendorId?: string) => ({
  'x-test-user': JSON.stringify({ id: USER, roles, ...(vendorId && { vendorId }) }),
});

describe('POST /v1/uploads/presign', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestInfraModule, StorageModule],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: DomainErrorFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderAuthGuard)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  const presign = (headers: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/uploads/presign', headers, payload });

  it('presigns a kyc upload for a customer, keyed by the caller id', async () => {
    const res = await presign(asUser(['CUSTOMER']), {
      purpose: 'kyc',
      contentType: 'application/pdf',
      size: 2048,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ url: string; key: string; headers: Record<string, string> }>();
    expect(body.key).toMatch(new RegExp(`^kyc/${USER}/`));
    expect(body.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(body.url).toContain('/kyc/kyc/');
    expect(body.url).toContain('X-Amz-Signature=');
    expect(body.url).toContain('content-length');
  });

  it('presigns media for a vendor using the vendorId from the token', async () => {
    const res = await presign(asUser(['VENDOR_STAFF'], VENDOR), {
      purpose: 'product-image',
      contentType: 'image/png',
      size: 100,
      vendorId: 'client-supplied-and-ignored',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ key: string }>().key).toMatch(new RegExp(`^media/vendors/${VENDOR}/`));
  });

  it('forbids kyc for a vendor-only user and media for a plain customer', async () => {
    const kyc = await presign(asUser(['VENDOR_OWNER'], VENDOR), {
      purpose: 'kyc',
      contentType: 'image/png',
      size: 100,
    });
    expect(kyc.statusCode).toBe(403);
    expect(kyc.json()).toMatchObject({ errorCode: 'common.error.forbidden' });

    const media = await presign(asUser(['CUSTOMER']), {
      purpose: 'vendor-logo',
      contentType: 'image/png',
      size: 100,
    });
    expect(media.statusCode).toBe(403);
  });

  it('forbids roles outside the allowed set', async () => {
    const res = await presign(asUser(['PLATFORM_ADMIN']), {
      purpose: 'kyc',
      contentType: 'image/png',
      size: 100,
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids a vendor role without a vendorId in the token', async () => {
    const res = await presign(asUser(['VENDOR_OWNER']), {
      purpose: 'vendor-logo',
      contentType: 'image/png',
      size: 100,
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects disallowed content types (422), oversize (413) and bad bodies (422)', async () => {
    const type = await presign(asUser(['CUSTOMER']), {
      purpose: 'kyc',
      contentType: 'image/gif',
      size: 100,
    });
    expect(type.statusCode).toBe(422);
    expect(type.json()).toMatchObject({ errorCode: 'upload.error.content-type-not-allowed' });

    const big = await presign(asUser(['CUSTOMER']), {
      purpose: 'kyc',
      contentType: 'image/png',
      size: 11 * 1024 * 1024,
    });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ errorCode: 'upload.error.too-large' });

    const bad = await presign(asUser(['CUSTOMER']), { purpose: 'nope', size: -1 });
    expect(bad.statusCode).toBe(422);
  });

  it('answers 403 when unauthenticated', async () => {
    const res = await presign({}, { purpose: 'kyc', contentType: 'image/png', size: 1 });
    expect(res.statusCode).toBe(403);
  });
});
