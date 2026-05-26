import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recibido por correo' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'NuevaC0ntraseña!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
