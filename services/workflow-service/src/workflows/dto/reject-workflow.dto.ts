import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * [RN-05] Las observaciones son obligatorias al rechazar. Mínimo 10 caracteres.
 */
export class RejectWorkflowDto {
  @ApiProperty({
    description: 'Motivo del rechazo. Obligatorio. Mínimo 10 caracteres.',
    minLength: 10,
    maxLength: 3000,
  })
  @IsString()
  @MinLength(10, { message: 'Las observaciones de rechazo deben tener al menos 10 caracteres' })
  @MaxLength(3000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  observations!: string;
}
