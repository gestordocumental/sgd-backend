// Correlation
export { correlationStorage, getClientIp, getCorrelationId } from './correlation/correlation.context';
export type { CorrelationStore } from './correlation/correlation.context';

// Logger
export { AppLogger } from './logger/app-logger.service';

// Interceptors
export { LoggingInterceptor } from './interceptors/logging.interceptor';

// Filters
export { HttpExceptionFilter } from './filters/http-exception.filter';

// Middleware
export { CorrelationMiddleware, CORRELATION_ID_HEADER } from './middleware/correlation.middleware';

// Metrics
export { MetricsModule } from './metrics/metrics.module';
export { MetricsController } from './metrics/metrics.controller';
export { getRegistry, getHttpRequestDurationHistogram } from './metrics/metrics.registry';

// Kafka
export { KAFKA_CLIENT, TOPICS } from './kafka/kafka.constants';
export type { TopicKey } from './kafka/kafka.constants';
export { KafkaModule } from './kafka/kafka.module';
export { KafkaProducerService } from './kafka/kafka-producer.service';
export { runWithCorrelation, withDlt } from './kafka/kafka-consumer.util';

// Guards
export { JwtGuard, SUPER_ADMIN_REVOCATION_CHECKER } from './guards/jwt.guard';
export { PermissionsGuard } from './guards/permissions.guard';

// Decorators
export { OrgMember, SuperAdminOnly, Auth, AUTH_KEY } from './decorators/auth.decorator';
export type { AuthMeta } from './decorators/auth.decorator';
export { JwtPayloadParam, jwtPayloadFactory } from './decorators/jwt-payload.decorator';
export type { JwtPayload } from './decorators/jwt-payload.decorator';
export { RequirePermission, PERMISSION_KEY } from './decorators/require-permission.decorator';
export type { RequiredPermission } from './decorators/require-permission.decorator';
