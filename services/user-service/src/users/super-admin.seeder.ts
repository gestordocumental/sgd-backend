import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User, RegistrationStatus } from './entities/user.entity';

/**
 * Fixed UUID for the super admin user.
 * Using a constant ensures the same record is upserted on every cold start
 * without ever creating duplicates, regardless of how many times the DB is reset.
 */
export const SUPER_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';

@Injectable()
export class SuperAdminSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminSeeder.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get<string>('SUPER_ADMIN_EMAIL');
    if (!email) {
      throw new Error('SUPER_ADMIN_EMAIL is required for super-admin seeding');
    }

    await this.userRepo
      .createQueryBuilder()
      .insert()
      .into(User)
      .values({
        id:                 SUPER_ADMIN_USER_ID,
        email,
        firstName:          'Super',
        lastName:           'Admin',
        isActive:           true,
        isSuperAdmin:       true,
        registrationStatus: RegistrationStatus.ACTIVE,
        idNumber:           null,
        position:           null,
        departamentoId:     null,
        areaId:             null,
        cargoId:            null,
      })
      .orIgnore() // ON CONFLICT DO NOTHING — idempotent on every restart
      .execute();

    this.logger.log('Super admin seeded');
  }
}
