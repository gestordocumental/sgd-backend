import 'reflect-metadata';
import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Initialize and start the NestJS application with logging and Swagger configuration.
 *
 * Sets the application's logger to the injected `AppLogger`, configures OpenAPI docs
 * (served at `api/metadata-extractor/docs`), and starts the HTTP server on the port
 * taken from `process.env.PORT` or `3004` if unset.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Metadata Extractor Service')
    .setDescription('Async Kafka worker that extracts metadata from uploaded documents (PDF, DOCX). Exposes only the health check endpoint.')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/metadata-extractor/docs', app, document);

  const port = process.env.PORT ?? 3004;
  await app.listen(port);
  logger.log(`metadata-extractor-service listening on port ${port}`, 'Bootstrap');
}

bootstrap();
