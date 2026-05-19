import 'reflect-metadata';

// Cargar .env antes del check — ConfigModule lo carga después pero aquí aún no está disponible
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

// Deshabilita validación de certificados TLS si hay un proxy SSL corporativo local.
// Solo activar en máquinas de desarrollo con proxy — NUNCA en Railway ni producción.
if (process.env.DISABLE_TLS_VERIFY === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(AppLogger);

  app.useLogger(logger);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  app.useGlobalInterceptors(new LoggingInterceptor(logger));
  app.useGlobalFilters(new HttpExceptionFilter(logger));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Notification Service')
    .setDescription('Gestión de notificaciones internas y envío de correos electrónicos')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/notifications/docs', app, document);

  const port = process.env.PORT ?? 3006;
  await app.listen(port);
  logger.log(`notification-service listening on port ${port}`, 'Bootstrap');
}

bootstrap();
