import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(AppLogger);

  // Replace NestJS default logger with our structured Winston logger
  app.useLogger(logger);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Logs every incoming request and outgoing response with correlationId
  app.useGlobalInterceptors(new LoggingInterceptor(logger));

  // Standardizes all exceptions — adds correlationId to every error response
  app.useGlobalFilters(new HttpExceptionFilter(logger));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`user-service listening on port ${port}`, 'Bootstrap');
}

bootstrap();
