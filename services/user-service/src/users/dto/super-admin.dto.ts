import { IsBoolean } from "class-validator";

  export class SetSuperAdminDto {
    @IsBoolean()
    enabled!: boolean;
  }