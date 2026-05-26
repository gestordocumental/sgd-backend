import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';
import { getHttpRequestDurationHistogram } from '../metrics/metrics.registry';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLogger) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const { method, path, ip, baseUrl, route } = req;
    const routeLabel = route?.path ? `${baseUrl ?? ''}${route.path}` : path;
    const startedAt = Date.now();

    this.logger.http({
      type: 'request',
      method,
      path,
      ip,
      correlationId: getCorrelationId(),
      message: `→ ${method} ${path}`,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startedAt;
          this.logger.http({
            type: 'response',
            method,
            path,
            statusCode: res.statusCode,
            duration,
            correlationId: getCorrelationId(),
            message: `← ${method} ${path} ${res.statusCode} (${duration}ms)`,
          });
          getHttpRequestDurationHistogram().observe(
            { method, route: routeLabel, status_code: String(res.statusCode) },
            duration / 1000,
          );
        },
        error: (err) => {
          const duration = Date.now() - startedAt;
          const statusCode =
            typeof err?.getStatus === 'function' ? err.getStatus() : (err?.status ?? 500);
          this.logger.http({
            type: 'response',
            method,
            path,
            statusCode,
            duration,
            correlationId: getCorrelationId(),
            message: `← ${method} ${path} ${statusCode} (${duration}ms)`,
          });
          getHttpRequestDurationHistogram().observe(
            { method, route: routeLabel, status_code: String(statusCode) },
            duration / 1000,
          );
        },
      }),
    );
  }
}
