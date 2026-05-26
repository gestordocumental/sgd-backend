import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsPositive,
  ValidateNested,
  ArrayMinSize,
  IsOptional,
  Matches,
} from 'class-validator';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AdminStepInputDto {
  @ApiProperty({ format: 'uuid', description: 'UUID del usuario administrativo' })
  @Matches(UUID_REGEX, { message: 'userId must be a UUID' })
  userId!: string;

  @ApiProperty({ minimum: 1, description: 'Orden de participación (1 = primero)' })
  @IsInt()
  @IsPositive()
  stepOrder!: number;
}

/**
 * [RN-11] Solo se puede crear si el workflow está en AVAILABLE_FOR_FINAL_USERS.
 * [RN-15] Solo un usuario final (en finalUserIds) puede iniciar el ciclo.
 */
export class CreateAdminCycleDto {
  @ApiProperty({
    type: [AdminStepInputDto],
    description: 'Usuarios administrativos en orden. Mínimo 1.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdminStepInputDto)
  steps!: AdminStepInputDto[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'UUIDs de usuarios que pueden actuar como revisores opcionales. ' +
      'Cualquier revisor obligatorio puede reenviar a uno de ellos antes de que avance al siguiente paso.',
  })
  @IsOptional()
  @IsArray()
  @Matches(UUID_REGEX, { each: true, message: 'each value in allowedOptionalReviewerIds must be a UUID' })
  allowedOptionalReviewerIds?: string[];
}
