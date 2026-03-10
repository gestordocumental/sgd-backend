import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateUserDto {
  @Transform(({ value }) => (value as string)?.toLowerCase().trim())
  @IsEmail()
  email!: string;

  // Required at creation — identifies the user's role in the company
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsNotEmpty()
  position!: string;
}
