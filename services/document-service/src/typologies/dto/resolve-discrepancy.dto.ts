import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ResolveAction {
  KEEP_DECLARED    = 'KEEP_DECLARED',
  ADOPT_EXTRACTED  = 'ADOPT_EXTRACTED',
  MANUAL_OVERRIDE  = 'MANUAL_OVERRIDE',
}

export class ResolveDiscrepancyDto {
  @ApiProperty({
    enum: ResolveAction,
    description: 'KEEP_DECLARED: use declared data | ADOPT_EXTRACTED: use extracted data | MANUAL_OVERRIDE: use provided values',
  })
  @IsEnum(ResolveAction)
  action!: ResolveAction;

  @ApiPropertyOptional({ description: 'Required when action is MANUAL_OVERRIDE', maxLength: 255 })
  @ValidateIf((o) => o.action === ResolveAction.MANUAL_OVERRIDE)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nombre?: string;

  @ApiPropertyOptional({ description: 'Required when action is MANUAL_OVERRIDE', maxLength: 100 })
  @ValidateIf((o) => o.action === ResolveAction.MANUAL_OVERRIDE)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  codigo?: string;

  @ApiPropertyOptional({ description: 'Required when action is MANUAL_OVERRIDE', maxLength: 50 })
  @ValidateIf((o) => o.action === ResolveAction.MANUAL_OVERRIDE)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;
}
