import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { DomainError } from '@repo/core';
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
