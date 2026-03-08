import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ProvisionUserDto } from './dto/provision-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

@Controller('api/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.create(dto));
  }

  @Get()
  async findAll(): Promise<UserResponseDto[]> {
    return (await this.usersService.findAll()).map(UserResponseDto.from);
  }

  @Get('by-email/:email')
  async findByEmail(@Param('email') email: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.findByEmail(email));
  }

  @Get(':id/companies')
  getCompanies(
    @Headers('x-internal-token') internalToken: string,
    @Param('id') id: string,
  ) {
    const expected = this.configService.getOrThrow<string>('INTERNAL_TOKEN');
    const isValid =
      internalToken?.length === expected.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(internalToken));
    if (!isValid) throw new UnauthorizedException();
    return this.usersService.getCompanies(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.findOne(id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.restore(id));
  }

  @Post(':id/provision')
  provision(@Param('id') id: string, @Body() dto: ProvisionUserDto) {
    return this.usersService.provision(id, dto);
  }
}
