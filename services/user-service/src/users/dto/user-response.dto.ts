import { User, RegistrationStatus } from '../entities/user.entity';

export class UserResponseDto {
  id!: string;
  email!: string;
  firstName!: string | null;
  lastName!: string | null;
  position!: string | null;
  idNumber!: string | null;
  departamentoId!: string | null;
  areaId!: string | null;
  cargoId!: string | null;
  registrationStatus!: RegistrationStatus;
  isActive!: boolean;
  isSuperAdmin!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  static from(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id                 = user.id;
    dto.email              = user.email;
    dto.firstName          = user.firstName;
    dto.lastName           = user.lastName;
    dto.position           = user.position;
    dto.idNumber           = user.idNumber;
    dto.departamentoId     = user.departamentoId;
    dto.areaId             = user.areaId;
    dto.cargoId            = user.cargoId;
    dto.registrationStatus = user.registrationStatus;
    dto.isActive           = user.isActive;
    dto.isSuperAdmin       = user.isSuperAdmin;
    dto.createdAt          = user.createdAt;
    dto.updatedAt          = user.updatedAt;
    return dto;
  }
}
