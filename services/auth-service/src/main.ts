import 'reflect-metadata';
import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Bootstraps and starts the NestJS application: creates the app, replaces the logger, registers global validation, logging interceptor and exception filter, configures Swagger, and begins listening on the configured port.
 */
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Auth Service')
    .setDescription('Authentication, JWT token management and credentials provisioning API')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-internal-token' }, 'internal-token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/auth/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`auth-service listening on port ${port}`, 'Bootstrap');
}

bootstrap();
