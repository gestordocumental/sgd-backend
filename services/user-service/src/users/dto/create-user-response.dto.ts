import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

export class CreateUserResponseDto extends UserResponseDto {
  @ApiProperty()
  invitationToken!: string;
}
