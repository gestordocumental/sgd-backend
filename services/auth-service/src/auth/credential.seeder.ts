import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Credential, CredentialStatus } from './entities/credential.entity';

/** Must match the fixed UUID in user-service SuperAdminSeeder */
const SUPER_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';

@Injectable()
export class CredentialSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(CredentialSeeder.name);

  constructor(
    @InjectRepository(Credential)
    private readonly credentialRepo: Repository<Credential>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email    = this.config.get<string>('SUPER_ADMIN_EMAIL');
    const password = this.config.get<string>('SUPER_ADMIN_PASSWORD');
    if (!email)    throw new Error('SUPER_ADMIN_EMAIL is required for super-admin seeding');
    if (!password) throw new Error('SUPER_ADMIN_PASSWORD is required for super-admin seeding');

    const existing = await this.credentialRepo.findOne({
      where: [{ userId: SUPER_ADMIN_USER_ID }, { email }],
    });

    if (existing) {
      this.logger.log('Super admin credential already exists — skipping');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await this.credentialRepo.save(
      this.credentialRepo.create({
        userId:       SUPER_ADMIN_USER_ID,
        email,
        passwordHash,
        status:       CredentialStatus.ACTIVE,
      }),
    );

    this.logger.log(`Super admin credential seeded (email: ${email})`);
  }
}
