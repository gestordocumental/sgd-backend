import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx    = host.switchToHttp();
    const req    = ctx.getRequest<Request>();
    const res    = ctx.getResponse<Response>();

    const isHttp   = exception instanceof HttpException;
    const status   = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawBody  = isHttp ? exception.getResponse() : null;

    const errorBody =
      typeof rawBody === 'object' && rawBody !== null
        ? rawBody
        : { message: isHttp ? exception.message : 'Internal server error' };

    const responseBody = {
      ...errorBody,
      statusCode:    status,
      correlationId: getCorrelationId(),
      timestamp:     new Date().toISOString(),
      path:          req.url,
    };

    if (status >= 500) {
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
        'HttpExceptionFilter',
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.url} → ${status}`,
        'HttpExceptionFilter',
      );
    }

    res.status(status).json(responseBody);
  }
}
