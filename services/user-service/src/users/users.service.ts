import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ProvisionUserDto } from './dto/provision-user.dto';
import { AuthClientService } from '../auth-client/auth-client.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly authClientService: AuthClientService,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepository.findOne({
      where: { email: dto.email },
    });

    // User already exists — caller should assign them to the org via user_org_roles
    if (existing) {
      throw new ConflictException({
        message: 'User with this email already exists',
        userId: existing.id,
      });
    }

    const user = this.usersRepository.create(dto);
    return this.usersRepository.save(user);
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async findByEmail(email: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) throw new NotFoundException(`User with email ${email} not found`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);
    Object.assign(user, dto);
    return this.usersRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.softRemove(user);
  }

  async restore(id: string): Promise<User> {
    await this.usersRepository.restore(id);
    return this.findOne(id);
  }

  /**
   * Provisions login credentials for a user by calling auth-service.
   * Called after the user record exists and has been assigned to an org.
   * If auth-service fails the user record is NOT rolled back — the admin
   * can retry calling this endpoint.
   */
  async provision(id: string, dto: ProvisionUserDto): Promise<{ ok: boolean }> {
    const user = await this.findOne(id);

    await this.authClientService.provisionCredentials({
      companyId: dto.companyId,
      userId:    user.id,
      email:     user.email,
      password:  dto.password,
    });

    return { ok: true };
  }
}
