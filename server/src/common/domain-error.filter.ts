import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { DomainError, ERROR_HTTP_STATUS, type ErrorCode, type ErrorResponse } from '@repo/core';
import { ZodValidationException } from 'nestjs-zod';

const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  401: 'common.error.unauthorized',
  403: 'common.error.forbidden',
  404: 'common.error.not-found',
  409: 'common.error.conflict',
  422: 'common.error.validation-failed',
  429: 'common.error.rate-limited',
};

/**
 * Every error leaves the API as `{ errorCode, params }` (Golden Rule #7) — the frontend
 * translates. DomainError carries its own code; Zod validation → 422; other HttpExceptions
 * map by status; anything else is logged and returned as 500 `common.error.internal`.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const { status, body } = this.toResponse(exception);
    void reply.code(status).send(body);
  }

  private toResponse(exception: unknown): { status: number; body: ErrorResponse } {
    if (exception instanceof DomainError) {
      return { status: exception.httpStatus, body: exception.toResponse() };
    }
    if (exception instanceof ZodValidationException) {
      const code: ErrorCode = 'common.error.validation-failed';
      return { status: ERROR_HTTP_STATUS[code], body: { errorCode: code, params: {} } };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_TO_CODE[status];
      if (code) return { status, body: { errorCode: code, params: {} } };
      if (status < 500) {
        return { status, body: { errorCode: 'common.error.validation-failed', params: {} } };
      }
    }
    this.logger.error(exception);
    return { status: 500, body: { errorCode: 'common.error.internal', params: {} } };
  }
}
