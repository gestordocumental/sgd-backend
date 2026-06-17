# metadata-extractor-service

Extrae metadatos estructurados (nombre, código, versión) de archivos documentales subidos a Cloudflare R2. Funciona de forma asíncrona vía Kafka y no tiene base de datos propia.

## Responsabilidades

- Escuchar `typology.file.uploaded` y descargar el archivo desde R2
- Parsear PDF, DOCX y XLSX para extraer campos estructurados según reglas configurables
- Emitir `typology.metadata.extracted` o `typology.metadata.extraction.failed` según el resultado
- Ofrecer un endpoint HTTP síncrono (`/preview-extract`) para extracción on-demand desde el frontend

## Infraestructura requerida

| Recurso | Uso |
|---|---|
| Cloudflare R2 | Lectura de archivos (solo lectura, comparte bucket con document-service) |
| Kafka (producer + consumer) | Recibe archivos, emite resultados |

> No tiene base de datos propia. Toda la persistencia ocurre en document-service.

## Endpoints

### Extracción de vista previa (`/api/v1/extractor`)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/preview-extract` | Extraer metadatos de un archivo en R2 de forma síncrona |

Útil para que el frontend muestre una preview de los metadatos antes de confirmar la subida.

## Kafka

| Topic | Rol | Cuándo |
|---|---|---|
| `typology.file.uploaded` | Consume | Dispara el proceso de extracción |
| `typology.metadata.extracted` | Produce | Extracción exitosa con nombre, código y versión |
| `typology.metadata.extraction.failed` | Produce | Error durante el parseo o descarga |

**Flujo completo:**
```
document-service
  → typology.file.uploaded
      → metadata-extractor-service (descarga R2, parsea)
          → typology.metadata.extracted  →  document-service (actualiza tipología)
          → typology.metadata.extraction.failed  →  document-service (marca error)
```

## Parsers soportados

| Formato | Estrategia |
|---|---|
| PDF | Extracción de texto de las primeras páginas + reglas de patrones |
| DOCX | Parsing de párrafos del documento Word |
| XLSX | Lectura de celdas de la primera hoja |

Las reglas de extracción están en `src/extractor/rules/metadata-rules.service.ts` y son configurables sin cambiar el código del parser.

## Scripts

```bash
npm test
npm run test:cov
npm run start:dev
```

## Variables de entorno

Ver `services/metadata-extractor-service/.env.example`. Variables críticas:
- `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`, `STORAGE_REGION`
- `KAFKA_BROKER`, `KAFKA_CLIENT_ID`, `KAFKA_CONSUMER_GROUP`
- `JWT_SECRET`
- `OTEL_EXPORTER_OTLP_ENDPOINT` (opcional)
