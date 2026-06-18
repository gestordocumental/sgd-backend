# audit-service

Registra y expone el historial de auditoría del sistema. Persiste todos los eventos de negocio en Elasticsearch y los expone vía API con filtros, paginación y exportación.

## Responsabilidades

- Consumir `audit.log` y persistir cada evento en Elasticsearch
- Consumir todos los topics `workflow.*` para avanzar offsets (drain consumer — evita lag infinito mientras no haya consumidor real)
- Exponer consultas paginadas con filtros por fecha, tipo de evento, usuario y organización
- Soportar exportación hasta 5.000 registros para análisis en Excel
- Restricción de visibilidad: usuarios de org solo ven su propia organización; super admin ve todo

## Infraestructura requerida

| Recurso | Uso |
|---|---|
| Elasticsearch 8.x | Almacenamiento e indexado de eventos de auditoría |
| Kafka (consumer) | Recibe `audit.log` y topics de workflow |

> Sin base de datos relacional. Toda la persistencia es en Elasticsearch.

## Endpoints (`/api/v1/audit`)

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| `GET` | `/logs` | `AUDIT:READ` | Consultar registro paginado con filtros |
| `GET` | `/logs/export` | `AUDIT:READ` | Exportar hasta 5.000 eventos |
| `GET` | `/logs/:id` | `AUDIT:READ` | Obtener evento por ID de Elasticsearch |

### Filtros disponibles en `/logs`

- `orgId` — filtrar por organización (super admin puede ver cualquiera; usuarios de org solo la propia)
- `actorId` — filtrar por usuario que realizó la acción
- `eventType` — tipo de evento
- `from` / `to` — rango de fechas (ISO 8601)
- `page` / `limit` — paginación

## Kafka

| Topic | Rol | Consumer group |
|---|---|---|
| `audit.log` | Consume | `KAFKA_CONSUMER_GROUP` |
| `workflow.*` (todos) | Consume (drain) | `KAFKA_CONSUMER_GROUP-workflow-drain` |

El drain consumer para `workflow.*` usa un consumer group separado (`-workflow-drain` suffix) para no interferir con el consumer de `audit.log`. Su único propósito es avanzar offsets de topics que no tienen consumidor real todavía, evitando acumulación de lag infinito en Kafka.

## Scripts

```bash
npm test
npm run test:cov
npm run start:dev
```

> audit-service usa Elasticsearch, no TypeORM — no tiene comandos de migración.

## Variables de entorno

Ver `services/audit-service/.env.example`. Variables críticas:
- `ELASTICSEARCH_NODE`
- `JWT_SECRET`
- `KAFKA_BROKER`, `KAFKA_CLIENT_ID`, `KAFKA_CONSUMER_GROUP`

### Credenciales de Elasticsearch en producción

En `NODE_ENV=production` el servicio requiere **dos conjuntos** de credenciales:

| Variable | Dónde se usa |
|---|---|
| `ELASTICSEARCH_USERNAME` | `main.ts` — validación al arrancar |
| `ELASTICSEARCH_PASSWORD` | `main.ts` — validación al arrancar |
| `WRITE_ELASTICSEARCH_USERNAME` | `audit.module.ts` — cliente de escritura |
| `WRITE_ELASTICSEARCH_PASSWORD` | `audit.module.ts` — cliente de escritura |
| `READ_ELASTICSEARCH_USERNAME` | `audit.module.ts` — cliente de lectura |
| `READ_ELASTICSEARCH_PASSWORD` | `audit.module.ts` — cliente de lectura |

Si solo se configuran los de rol (`WRITE_*` / `READ_*`) sin los genéricos, **el servicio crashea al arrancar** porque `main.ts` verifica los genéricos primero.

## Arquitectura de índices Elasticsearch

Cada evento de auditoría se indexa con al menos:
- `orgId` — organización del actor
- `actorId` — usuario que realizó la acción
- `eventType` — tipo de evento
- `payload` — datos del evento (varía por tipo)
- `@timestamp` — marca temporal del evento
