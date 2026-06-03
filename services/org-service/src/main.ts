import 'reflect-metadata';
import './instrument';
import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppLogger, LoggingInterceptor, HttpExceptionFilter } from '@sgd/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });

  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  const logger = app.get(AppLogger);

  app.useLogger(logger);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  app.useGlobalInterceptors(new LoggingInterceptor(logger));
  app.useGlobalFilters(new HttpExceptionFilter(logger));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Org Service')
    .setDescription('Organizations, departments, areas, positions and bulk structure management API')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-internal-token' }, 'internal-token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/org/docs', app, document);

  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  logger.log(`org-service listening on port ${port}`, 'Bootstrap');
}

bootstrap();
