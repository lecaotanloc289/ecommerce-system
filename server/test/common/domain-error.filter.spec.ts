import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { CrmTemplateTextSchema, DomainError } from '@repo/core';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { DomainErrorFilter } from '../../src/common/domain-error.filter';

function run(exception: unknown) {
  const reply = { code: jest.fn(), send: jest.fn() };
  reply.code.mockReturnValue(reply);
  new DomainErrorFilter().catch(exception, new ExecutionContextHost([{}, reply]));
  return { status: reply.code.mock.calls[0][0], body: reply.send.mock.calls[0][0] };
}

describe('DomainErrorFilter', () => {
  it('maps DomainError to its status + { errorCode, params }', () => {
    expect(run(new DomainError('auth.error.refresh-revoked', { a: 1 }))).toEqual({
      status: 401,
      body: { errorCode: 'auth.error.refresh-revoked', params: { a: 1 } },
    });
  });

  it('maps Zod validation failures to 422', () => {
    const error = z.object({ a: z.string() }).safeParse({}).error;
    expect(run(new ZodValidationException(error))).toEqual({
      status: 422,
      body: { errorCode: 'common.error.validation-failed', params: {} },
    });
  });

  it('surfaces a 422 domain error recorded by a core schema refinement (with params)', () => {
    const error = z
      .object({ body: CrmTemplateTextSchema })
      .safeParse({ body: 'Xem tại https://x.vn nhé' }).error;
    expect(run(new ZodValidationException(error))).toEqual({
      status: 422,
      body: { errorCode: 'crm.error.links-not-allowed', params: { match: 'https://' } },
    });
  });

  it('ignores custom issues whose message is not a 422 error code', () => {
    const notCode = z
      .string()
      .refine(() => false, { message: 'Duplicate tags' })
      .safeParse('x').error;
    const not422 = z
      .string()
      .refine(() => false, { message: 'crm.error.not-a-customer' })
      .safeParse('x').error;
    for (const error of [notCode, not422]) {
      expect(run(new ZodValidationException(error)).body).toEqual({
        errorCode: 'common.error.validation-failed',
        params: {},
      });
    }
  });

  it('maps framework HttpExceptions by status', () => {
    expect(run(new NotFoundException()).body.errorCode).toBe('common.error.not-found');
    expect(run(new ForbiddenException()).body.errorCode).toBe('common.error.forbidden');
  });

  it('hides unknown errors behind a 500 (and logs them)', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(run(new Error('secret detail'))).toEqual({
      status: 500,
      body: { errorCode: 'common.error.internal', params: {} },
    });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
