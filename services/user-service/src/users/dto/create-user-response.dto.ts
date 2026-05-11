import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

export class CreateUserResponseDto extends UserResponseDto {
  @ApiProperty({
    description:
      'Token de invitación de un solo uso (72 h). ' +
      'El mismo token se envía por correo al usuario. ' +
      'Úsalo solo como fallback si el email no llegó.',
    example: 'a3f8...hex64chars',
  })
  invitationToken!: string;
}
