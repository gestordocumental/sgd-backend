import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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
