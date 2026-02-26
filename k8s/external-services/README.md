# External Services — Puente Kind ↔ docker-compose

Los ConfigMaps de los microservicios usan DNS interno de K8s:
  postgresql.sgd-infra.svc.cluster.local
  mongodb.sgd-infra.svc.cluster.local
  ...

Los servicios ExternalName resuelven esos nombres hacia `host.docker.internal`,
que Docker Desktop mapea automáticamente a la IP del host en Windows/Mac.

Flujo:
  Pod en Kind → postgresql.sgd-infra.svc.cluster.local
              → ExternalName Service (sgd-infra)
              → host.docker.internal
              → docker-compose PostgreSQL en localhost:5432
