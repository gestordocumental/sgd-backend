import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Solo cancelable desde AVAILABLE_FOR_FINAL_USERS, por un usuario final
 * designado, y siempre con un motivo — a diferencia del cierre, que lo deja
 * opcional.
 */
export class CancelWorkflowDto {
  @ApiProperty({
    description: 'Motivo de la cancelación, obligatorio',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  reason!: string;
}
