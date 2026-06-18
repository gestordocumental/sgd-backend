import { Injectable, LoggerService } from '@nestjs/common';
import { createLogger, format, transports, Logger } from 'winston';
import { getCorrelationId } from '../correlation/correlation.context';

const SERVICE_NAME = 'workflow-service';

@Injectable()
export class AppLogger implements LoggerService {
  private readonly winston: Logger;

  constructor() {
    const isDev = process.env.NODE_ENV === 'development';

    this.winston = createLogger({
      level: isDev ? 'debug' : 'info',
      format: isDev ? this.devFormat() : this.prodFormat(),
      transports: [new transports.Console()],
    });
  }

  log(message: string, context?: string) {
    this.winston.info(this.build('info', message, context));
  }

  error(message: string, trace?: string, context?: string) {
    this.winston.error(this.build('error', message, context, { trace }));
  }

  warn(message: string, context?: string) {
    this.winston.warn(this.build('warn', message, context));
  }

  debug(message: string, context?: string) {
    this.winston.debug(this.build('debug', message, context));
  }

  http(data: Record<string, unknown>) {
    this.winston.info({ ...data, correlationId: getCorrelationId(), service: SERVICE_NAME });
  }

  private build(
    level: string,
    message: string,
    context?: string,
    extra?: Record<string, unknown>,
  ) {
    return {
      level,
      message,
      context: context ?? 'App',
      correlationId: getCorrelationId(),
      service: SERVICE_NAME,
      ...extra,
    };
  }

  private devFormat() {
    return format.combine(
      format.colorize(),
      format.timestamp({ format: 'HH:mm:ss' }),
      format.printf(({ timestamp, level, message, context, correlationId, ...rest }) => {
        const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
        return `${timestamp} [${level}] [${context}] [${correlationId}] ${message}${extra}`;
      }),
    );
  }

  private prodFormat() {
    return format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.json(),
    );
  }
}
