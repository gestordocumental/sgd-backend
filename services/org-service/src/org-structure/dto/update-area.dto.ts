import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class UpdateAreaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
