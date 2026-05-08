import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsArray, ArrayMinSize, MinLength, MaxLength, Matches } from 'class-validator';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NotifyNoFinalUsersDto {
  @ApiProperty({ description: 'ID de la tipología sin usuarios finales elegibles' })
  @IsString()
  @MinLength(1)
  @MaxLength(24)
  typologyId!: string;

  @ApiProperty({ description: 'Nombre de la tipología para incluir en la notificación' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  typologyName!: string;

  @ApiProperty({
    type: [String],
    description: 'UUIDs de los administradores de la organización que recibirán la notificación',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(UUID_REGEX, { each: true, message: 'Each recipientId must be a UUID' })
  recipientIds!: string[];
}
