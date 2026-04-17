import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User, RegistrationStatus } from '../entities/user.entity';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  firstName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  lastName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  position!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  idNumber!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  departamentoId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  areaId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  cargoId!: string | null;

  @ApiProperty({ enum: RegistrationStatus })
  registrationStatus!: RegistrationStatus;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  isSuperAdmin!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.position = user.position;
    dto.idNumber = user.idNumber;
    dto.departamentoId = user.departamentoId;
    dto.areaId = user.areaId;
    dto.cargoId = user.cargoId;
    dto.registrationStatus = user.registrationStatus;
    dto.isActive = user.isActive;
    dto.isSuperAdmin = user.isSuperAdmin;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }
}
