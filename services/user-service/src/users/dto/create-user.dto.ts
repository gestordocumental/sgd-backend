import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  // Required at creation — identifies the user's role in the company
  @IsString()
  @IsNotEmpty()
  position!: string;
}
