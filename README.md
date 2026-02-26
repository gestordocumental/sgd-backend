# Sistema de Gestión Documental — Backend

Plataforma de gestión documental multi-tenant basada en microservicios, desplegada en Kubernetes (KinD para local, cualquier proveedor cloud en producción).

---

## Arquitectura

```
Frontend (puerto 3001)
        │
        ▼
  Kong API Gateway (:8080)          ← único punto de entrada externo
        │
        ├── /api/auth/*    → auth-service        (NestJS + PostgreSQL + Redis)
        ├── /api/users/*   → user-service         (NestJS + PostgreSQL + Redis)
        ├── /api/org/*     → org-service          (NestJS + PostgreSQL)
        ├── /api/documents/* → document-service  (NestJS + MongoDB + MinIO)
        ├── /api/workflows/* → workflow-service  (NestJS + PostgreSQL + Kafka)
        ├── /api/notifications/* → notification-service (NestJS + Redis + Kafka)
        └── /api/audit/*   → audit-service       (NestJS + Elasticsearch + Kafka)

Infraestructura (Docker Compose en local / Helm en prod):
  PostgreSQL · MongoDB · Redis · Kafka · MinIO · Elasticsearch
```

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 + NestJS 10 |
| API Gateway | Kong 3.4 (DB-less, declarativo) |
| Orquestación | Kubernetes — KinD (local) |
| Auth | JWT HS256 (access + refresh con rotación) |
| BD relacional | PostgreSQL 15 |
| BD documental | MongoDB 7 |
| Caché / sesiones | Redis 7 |
| Mensajería | Apache Kafka (KRaft, sin Zookeeper) |
| Object storage | MinIO (compatible S3) |
| Búsqueda / auditoría | Elasticsearch 8 |

---

## Estructura del proyecto

```
document-management-system/
├── kind-config.yaml              # Cluster KinD: 1 control-plane + 2 workers
├── docker-compose.yml            # Infraestructura local (DBs, Kafka, MinIO, ES)
│
├── docker/
│   └── postgres-init/
│       └── init-databases.sh     # Crea DBs y usuarios al iniciar PostgreSQL
│
├── k8s/                          # Manifiestos Kubernetes
│   ├── namespaces/               # gestor-documental · sgd-infra · sgd-monitoring
│   ├── external-services/        # ExternalName: puente Kind → Docker Compose
│   ├── api-gateway/              # Kong: configmap, deployment, service, secret
│   ├── auth-service/             # configmap, deployment, service, secret
│   ├── user-service/
│   ├── org-service/
│   ├── document-service/
│   ├── workflow-service/
│   ├── notification-service/
│   └── audit-service/
│
├── helm/
│   └── values/                   # Values de Helm para infraestructura en prod
│
└── services/                     # Código fuente de los microservicios
    └── auth-service/             # NestJS — autenticación y credenciales
        ├── Dockerfile
        ├── src/
        │   ├── main.ts
        │   ├── app.module.ts
        │   ├── auth/             # controller, service, DTOs, entity
        │   ├── health/           # /health/startup · /health/live · /health/ready
        │   └── redis/            # módulo Redis global
        └── .env.example
```

---

## Prerrequisitos

| Herramienta | Versión mínima | Instalación |
|---|---|---|
| Docker Desktop | 20+ | https://www.docker.com/products/docker-desktop |
| KinD | 0.17+ | `choco install kind` o https://kind.sigs.k8s.io |
| kubectl | 1.25+ | incluido en Docker Desktop |
| Node.js | 20+ | https://nodejs.org |
| Git | — | https://git-scm.com |

---

## Ejecución en Local

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd document-management-system
```

### 2. Levantar infraestructura (Docker Compose)

```bash
docker compose up -d

# Verificar que todos los servicios están healthy (~60 segundos)
docker compose ps
```

Servicios disponibles tras arrancar:

| Servicio | URL |
|---|---|
| PostgreSQL | localhost:5432 |
| MongoDB | localhost:27017 |
| Redis | localhost:6379 |
| Kafka | localhost:9094 |
| Kafka UI | http://localhost:8090 |
| MinIO Console | http://localhost:9001 (admin: `minio_admin` / `minio_secret_local`) |
| Elasticsearch | http://localhost:9200 |

### 3. Crear el cluster KinD

```bash
kind create cluster --config kind-config.yaml

# Verificar los 3 nodos
kubectl get nodes
```

### 4. Aplicar manifiestos Kubernetes

```bash
# Namespaces
kubectl apply -f k8s/namespaces/

# Puentes ExternalName (Kind → Docker Compose)
kubectl apply -f k8s/external-services/

# API Gateway (Kong)
kubectl apply -f k8s/api-gateway/

# Configs y secrets de cada microservicio
kubectl apply -f k8s/auth-service/
kubectl apply -f k8s/user-service/
kubectl apply -f k8s/org-service/
kubectl apply -f k8s/document-service/
kubectl apply -f k8s/workflow-service/
kubectl apply -f k8s/notification-service/
kubectl apply -f k8s/audit-service/
```

### 5. Construir y desplegar microservicios

Por cada servicio en `services/`:

```bash
# Ejemplo con auth-service
cd services/auth-service
cp .env.example .env        # completar con valores locales
npm install
npm run build

cd ../..
docker build -t auth-service:1.0.0 ./services/auth-service
kind load docker-image auth-service:1.0.0 --name sgd-local
kubectl rollout restart deployment/auth-service -n gestor-documental
```

### 6. Desarrollo activo (sin Docker/K8s)

Para iterar rápido en un servicio individual, córrelo directo en la máquina:

```bash
cd services/auth-service
cp .env.example .env   # DB_HOST=localhost, REDIS_HOST=localhost, etc.
npm run start:dev      # hot-reload con watch
```

El servicio queda disponible en `http://localhost:3000`.
Kong en `:8080` sigue siendo el punto de entrada para probar el flujo completo.

---

## API — Endpoints principales

Todas las rutas pasan por Kong en `http://localhost:8080`.
Las rutas marcadas con `JWT` requieren header `Authorization: Bearer <token>`.

### Auth Service

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/auth/credentials/provision` | `x-internal-token` | Crea credenciales (llamado por user-service) |
| POST | `/api/auth/login` | `x-company-id` header | Login → devuelve accessToken + refreshToken |
| POST | `/api/auth/refresh` | — | Rota el refresh token |
| GET | `/api/auth/me` | JWT | Retorna identidad del usuario autenticado |

---

## Ejecución en Producción

> Los secrets de producción NUNCA se almacenan en el repositorio.
> Usar un gestor de secretos (HashiCorp Vault, AWS Secrets Manager, Sealed Secrets).

### Infraestructura

En producción la infraestructura se despliega con Helm en lugar de Docker Compose.
Los `values/` en `helm/values/` son la base de configuración para cada chart.

```bash
# Ejemplo: PostgreSQL con Bitnami chart
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install postgresql bitnami/postgresql \
  -f helm/values/postgresql-values.yaml \
  -n sgd-infra
```

### Microservicios

1. **Build y push** de imágenes a un registry (ECR, GCR, Docker Hub):

```bash
docker build -t <registry>/auth-service:1.0.0 ./services/auth-service
docker push <registry>/auth-service:1.0.0
```

2. **Actualizar** el campo `image` en `k8s/auth-service/deployment.yaml`:

```yaml
image: <registry>/auth-service:1.0.0
```

3. **Aplicar** los manifiestos en el cluster de producción:

```bash
kubectl apply -f k8s/namespaces/
kubectl apply -f k8s/api-gateway/
kubectl apply -f k8s/auth-service/
# ... resto de servicios
```

### Variables de entorno en producción

Los `secret.yaml` del repositorio contienen valores de desarrollo.
En producción reemplazarlos con un pipeline CI/CD que inyecte los valores reales:

```bash
# Ejemplo con kubectl + variables de CI
kubectl create secret generic auth-service-secret \
  --from-literal=DB_USERNAME="$PROD_DB_USER" \
  --from-literal=DB_PASSWORD="$PROD_DB_PASS" \
  --from-literal=JWT_SECRET="$PROD_JWT_SECRET" \
  --from-literal=JWT_REFRESH_SECRET="$PROD_JWT_REFRESH_SECRET" \
  -n gestor-documental
```

---

## Comandos útiles

```bash
# Ver estado de todos los pods
kubectl get pods -n gestor-documental

# Logs de un servicio en tiempo real
kubectl logs deployment/auth-service -n gestor-documental -f

# Logs del API Gateway (Kong)
kubectl logs deployment/api-gateway -n gestor-documental -f

# Verificar rutas de Kong
curl http://localhost:8001/routes

# Reiniciar un pod tras actualizar la imagen
kubectl rollout restart deployment/<nombre> -n gestor-documental

# Parar toda la infraestructura local
docker compose down
kind delete cluster --name sgd-local
```
