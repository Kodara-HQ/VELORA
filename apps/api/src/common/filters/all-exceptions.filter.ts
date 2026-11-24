import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT',
  422: 'VALIDATION_FAILED', 423: 'LOCKED', 429: 'TOO_MANY_REQUESTS', 500: 'INTERNAL_ERROR',
};

/** Converts every error into the standard `{ success: false, error }` envelope. Never leaks internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong. Please try again.';
    let details: unknown;
    let code: string | undefined;

    if (exception instanceof ThrottlerException) {
      status = 429;
      message = 'Too many requests. Please slow down and try again shortly.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as string | { message?: string | string[]; code?: string; details?: unknown };
      if (typeof body === 'string') message = body;
      else {
        if (Array.isArray(body.message)) {
          message = 'Some fields are invalid.';
          details = body.message;
          status = 422;
        } else if (body.message) message = body.message;
        code = body.code;
        details = details ?? body.details;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        message = 'A record with these details already exists.';
        details = { fields: exception.meta?.target };
      } else if (exception.code === 'P2025') {
        status = 404;
        message = 'Record not found.';
      } else {
        this.logger.error(`Prisma ${exception.code}: ${exception.message}`);
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      success: false,
      error: { code: code ?? CODE_BY_STATUS[status] ?? 'ERROR', message, ...(details !== undefined && { details }) },
    });
  }
}
