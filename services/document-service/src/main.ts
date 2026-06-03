import 'reflect-metadata';
import './instrument';
import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppLogger, LoggingInterceptor, HttpExceptionFilter } from '@sgd/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Bootstraps and starts the NestJS application for the Document Service.
 *
 * Configures application-level logging, validation, interceptors, and exception handling;
 * builds and mounts the Swagger/OpenAPI documentation (including JWT bearer auth) at
 * `api/documents/docs`; then starts the HTTP server on `process.env.PORT` or `3003`
 * and logs the startup message.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });

  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new LoggingInterceptor(logger));
  app.useGlobalFilters(new HttpExceptionFilter(logger));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Document Service')
    .setDescription('Document typologies, bulk Excel import, file upload and metadata extraction API')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/documents/docs', app, document);

  const port = process.env.PORT ?? 3003;
  await app.listen(port);
  logger.log(`document-service listening on port ${port}`, 'Bootstrap');
}

bootstrap();
