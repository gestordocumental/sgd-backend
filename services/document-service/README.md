# document-service

Gestiona las tipologías documentales y los archivos subidos a ellas. Actúa como puente entre el almacenamiento en Cloudflare R2 y el resto del sistema, y coordina la extracción de metadatos con metadata-extractor-service vía Kafka.

## Responsabilidades

- CRUD de tipologías documentales por organización
- Upload de archivos (PDF, DOCX, XLSX) a Cloudflare R2
- Orquestación del flujo de extracción: produce `typology.file.uploaded`, consume el resultado (`typology.metadata.extracted` / `typology.metadata.extraction.failed`) y actualiza la tipología
- Acceso a archivos de workflows (para que workflow-service los adjunte)
- Importación masiva de tipologías
- Endpoint interno para que workflow-service consulte info de tipologías

## Infraestructura requerida

| Recurso | Uso |
|---|---|
| MongoDB | Tipologías y sus metadatos extraídos |
| Cloudflare R2 | Archivos de tipologías y documentos de workflow |
| ClamAV (`clamd`) | Escaneo de malware previo al upload |
| Kafka (producer + consumer) | Orquestación de extracción de metadatos |

## Endpoints

### Upload de documentos (`/api/v1/documents/:orgId/typologies/:id`)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/upload` | Subir archivo a R2 y disparar extracción de metadatos |
| `GET` | `/` | Info de la tipología con sus archivos |
| `GET` | `/signed-url` | URL firmada de corta duración para descarga directa |

### Tipologías (`/api/v1/documents/typologies`)

| Método | Ruta | Acceso |
|---|---|---|
| `POST` | `/` | super admin |
| `GET` | `/` | `DOCUMENTS:READ` |
| `GET` | `/:id` | `DOCUMENTS:READ` |
| `PATCH` | `/:id` | super admin |
| `DELETE` | `/:id` | super admin |

### Admin (`/api/v1/documents/admin`)

| Método | Ruta | Acceso |
|---|---|---|
| `GET` | `/storage-per-org` | super admin — uso de almacenamiento por org |

### Archivos de workflows (`/api/v1/documents/workflow-files`)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Listar archivos asociados a workflows |

### Importación masiva (`/api/v1/documents/bulk-import`)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/` | Importar múltiples tipologías desde CSV/Excel |

### Internos (`InternalGuard` — `INTERNAL_TOKEN_WORKFLOW_DOC`)

| Método | Ruta | Llamado por |
|---|---|---|
| `GET` | `/internal/typologies/:id/info` | workflow-service al crear un workflow |

## Kafka

| Topic | Rol | Cuándo |
|---|---|---|
| `typology.file.uploaded` | Produce | Al subir un archivo a una tipología |
| `typology.metadata.extracted` | Consume | Actualiza nombre, código y versión de la tipología |
| `typology.metadata.extraction.failed` | Consume | Marca la tipología con error de extracción |
| `audit.log` | Produce | Acciones sobre tipologías y documentos |

## Scripts

```bash
npm test
npm run test:cov
npm run start:dev
```

> document-service usa MongoDB, no TypeORM — no tiene comandos de migración.

## Variables de entorno

Ver `services/document-service/.env.example`. Variables críticas:
- `MONGODB_URI`
- `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`, `STORAGE_REGION`
- `JWT_SECRET`
- `KAFKA_BROKER`, `KAFKA_CLIENT_ID`, `KAFKA_CONSUMER_GROUP`
- `INTERNAL_TOKEN` (JwtGuard genérico para rutas con `x-internal-token`)
- `INTERNAL_TOKEN_WORKFLOW_DOC` (InternalGuard para `/internal/*`)
- `METADATA_EXTRACTOR_URL`
- `CLAMAV_HOST`, `CLAMAV_PORT` (default `3310`), `CLAMAV_TIMEOUT_MS` (default `15000`), `CLAMAV_REQUIRED` (`false` en dev/test, `true` en producción)

## Notas de arquitectura

**Dos sistemas de token interno coexisten en este servicio:**
1. `JwtGuard` (legado) — acepta el header `x-internal-token` con el valor de `INTERNAL_TOKEN` en cualquier ruta
2. `InternalGuard` (nuevo) — valida `INTERNAL_TOKEN_WORKFLOW_DOC` + CIDR check en rutas `/internal/*`

Ambos deben estar configurados o el servicio rechazará llamadas legítimas.
