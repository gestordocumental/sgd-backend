import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsUUID,
  IsArray,
  IsInt,
  IsPositive,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';

export class AdminStepInputDto {
  @ApiProperty({ format: 'uuid', description: 'UUID del usuario administrativo' })
  @IsUUID()
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
}
