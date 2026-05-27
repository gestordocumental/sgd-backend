import 'reflect-metadata';
import './instrument';

// Cargar .env antes del check — ConfigModule lo carga después pero aquí aún no está disponible
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

// Deshabilita validación de certificados TLS si hay un proxy SSL corporativo local.
// Solo activar en máquinas de desarrollo con proxy — NUNCA en Railway ni producción.
if (process.env.DISABLE_TLS_VERIFY === 'true') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DISABLE_TLS_VERIFY no puede habilitarse en producción');
  }
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Bootstraps and starts the NestJS application: creates the app, installs the application logger, registers global validation, logging interceptor and HTTP exception filter, configures Swagger (Bearer JWT) at `api/audit/docs`, and listens on the port from `process.env.PORT` or `3007`.
 */
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
    .setTitle('Audit Service')
    .setDescription('Registro de auditoría centralizado — consulta de eventos de todos los microservicios')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/audit/docs', app, document);

  const port = process.env.PORT ?? 3007;
  await app.listen(port);
  logger.log(`audit-service listening on port ${port}`, 'Bootstrap');
}

bootstrap();
