# @sgd/common

Paquete interno compartido por todos los microservicios del sistema SGD. Centraliza infraestructura transversal: logging, Kafka, guards, métricas, trazabilidad y decoradores de NestJS.

No se publica en npm — es `"private": true` y se referencia vía `paths` de TypeScript en cada servicio.

---

## Uso

```typescript
// Importar desde el alias del monorepo
import { AppLogger, KafkaModule, JwtGuard } from '@sgd/common';
```

En **producción** se consume el build compilado (`dist/`). En **tests unitarios** Jest resuelve directamente el source TypeScript:

```js
// jest.config.js de cada servicio
moduleNameMapper: {
  '^@sgd/common$': '<rootDir>/../../../packages/common/src/index.ts',
  '^@sgd/common/(.*)$': '<rootDir>/../../../packages/common/src/$1',
}
```

---

## Módulos exportados

### `AppLogger`

Logger estructurado basado en Winston. Emite JSON con `correlationId`, `service` y nivel de log. Incluir en el módulo raíz del servicio como provider.

```typescript
import { AppLogger } from '@sgd/common';
```

### `KafkaModule`

Módulo NestJS que registra un `KafkaProducerService` listo para usar. Requiere dos variables de entorno:

| Variable | Descripción |
|---|---|
| `KAFKA_CLIENT_ID` | Identificador del cliente Kafka (ej. `auth-service`) |
| `KAFKA_BROKER` | Dirección del broker (ej. `kafka.railway.internal:9092`) |

```typescript
import { KafkaModule, KafkaProducerService, TOPICS } from '@sgd/common';

// Emitir un evento
await this.kafkaProducer.emitSafe(TOPICS.AUDIT_LOG, payload);
```

`emitSafe()` traga errores de Kafka sin lanzar excepción — el servicio nunca muere por un fallo de mensajería.

### `TOPICS`

Constante con todos los nombres de topics Kafka del sistema. Fuente de verdad única — nunca usar strings literales.

```typescript
TOPICS.AUDIT_LOG                          // 'audit.log'
TOPICS.NOTIFICATION_SEND                  // 'notification.send'
TOPICS.WORKFLOW_CREATED                   // 'workflow.created'
// … 23 topics en total (ver kafka/kafka.constants.ts)
```

### Guards

| Guard | Descripción |
|---|---|
| `JwtGuard` | Valida JWT en `Authorization: Bearer`. También acepta `x-internal-token` genérico para llamadas entre servicios. |
| `PermissionsGuard` | Verifica permisos de org via `@RequirePermission()`. Requiere que `JwtGuard` haya corrido primero. |
| `InternalGuard` | Para endpoints `/internal/*`. Valida IP contra `INTERNAL_ALLOWED_CIDRS` + token específico por par de servicios via `@AllowInternalTokens()`. |

```typescript
import { InternalGuard } from '@sgd/common';
import { AllowInternalTokens } from '@sgd/common';

@UseGuards(InternalGuard)
@AllowInternalTokens('INTERNAL_TOKEN_WORKFLOW_DOC')
@Post('internal/some-endpoint')
handle() {}
```

`InternalGuard` lee la variable `INTERNAL_ALLOWED_CIDRS` del entorno. En Railway usar `100.64.0.0/10`. Si no está definida, el check de IP se omite (warn en logs).

### Decoradores

| Decorador | Uso |
|---|---|
| `@Auth()` / `@OrgMember()` / `@SuperAdminOnly()` | Control de acceso sobre `JwtGuard` |
| `@JwtPayloadParam()` | Extrae el payload JWT del request en un parámetro del handler |
| `@RequirePermission(action, resource)` | Requiere un permiso específico del usuario en la org |
| `@AllowInternalTokens(...envKeys)` | Declara qué variables de token acepta `InternalGuard` en un endpoint |

```typescript
import { JwtPayloadParam, JwtPayload } from '@sgd/common';

@Get('profile')
getProfile(@JwtPayloadParam() user: JwtPayload) {
  return user.sub; // userId
}
```

### `MetricsModule` / `MetricsController`

Expone el endpoint `/metrics` en formato Prometheus. Importar en el módulo raíz:

```typescript
import { MetricsModule } from '@sgd/common';

@Module({ imports: [MetricsModule] })
export class AppModule {}
```

### `initTracing(serviceName)`

Inicializa OpenTelemetry con auto-instrumentación (HTTP, Express, PostgreSQL, Redis, KafkaJS). **Debe llamarse antes de cualquier otro import**, en `instrument.ts`:

```typescript
// instrument.ts  ← primer archivo en ejecutarse
import { initTracing } from '@sgd/common';
initTracing('auth-service');
```

Es no-op cuando `OTEL_EXPORTER_OTLP_ENDPOINT` no está definida (entornos locales y tests).

### Correlation / CorrelationMiddleware

Propaga el `x-correlation-id` entre requests. Registrar como middleware global:

```typescript
import { CorrelationMiddleware } from '@sgd/common';

export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
```

---

## Variables de entorno requeridas

| Variable | Requerida por | Descripción |
|---|---|---|
| `KAFKA_CLIENT_ID` | `KafkaModule` | ID del cliente KafkaJS |
| `KAFKA_BROKER` | `KafkaModule` | Host:puerto del broker |
| `JWT_SECRET` | `JwtGuard` | Clave de verificación de tokens |
| `INTERNAL_ALLOWED_CIDRS` | `InternalGuard` | CIDRs permitidos (opcional, Railway: `100.64.0.0/10`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `initTracing` | URL del colector OTLP (opcional) |

---

## Compilar

```bash
cd packages/common
npm run build        # genera dist/
npm run build:watch  # modo watch para desarrollo
```

Los servicios en producción importan desde `dist/`. No se necesita compilar para correr tests unitarios.
