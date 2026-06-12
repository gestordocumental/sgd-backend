import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token obtained from /api/auth/login' })
  @IsString()
  refreshToken!: string;
}
