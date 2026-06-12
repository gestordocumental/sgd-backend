import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetOptionalReviewerDto {
  @ApiProperty({ description: 'Set to true to mark the user as optional reviewer in the org, false to remove' })
  @IsBoolean()
  value!: boolean;
}
