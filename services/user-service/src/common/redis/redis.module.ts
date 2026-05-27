import { Module, Global } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

// Global so any module can inject REDIS_CLIENT without importing RedisModule
@Global()
@Module({
  providers: [
    {
      provide: "REDIS_CLIENT",
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>("REDIS_HOST");
        const portRaw = config.get<string>("REDIS_PORT");
        const port = Number(portRaw);

        if (!host || !Number.isInteger(port) || port <= 0) {
          throw new Error("Invalid REDIS_HOST/REDIS_PORT configuration");
        }

        return new Redis({
          host,
          port,
          // empty password ("") → undefined so ioredis does not send AUTH
          password: config.get<string>("REDIS_PASSWORD") || undefined,
          lazyConnect: false,
        });
      },
    },
  ],
  exports: ["REDIS_CLIENT"],
})
export class RedisModule {}
