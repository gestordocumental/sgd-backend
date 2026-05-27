import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApproverStepDto, WorkflowFileDto } from './create-workflow.dto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Solo se puede actualizar un workflow en estado DRAFT.
 * [RN-09] No se puede modificar un workflow con status != DRAFT.
 */
export class UpdateWorkflowDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  description?: string;

  @ApiPropertyOptional({
    type: WorkflowFileDto,
    description: 'Reemplaza el documento principal',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowFileDto)
  mainDocument?: WorkflowFileDto;

  @ApiPropertyOptional({
    type: [WorkflowFileDto],
    description: 'Reemplaza todos los adjuntos de soporte existentes',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowFileDto)
  attachments?: WorkflowFileDto[];

  @ApiPropertyOptional({
    type: [ApproverStepDto],
    description: 'Reemplaza toda la lista de aprobadores',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApproverStepDto)
  approvers?: ApproverStepDto[];

  @ApiPropertyOptional({
    type: [String],
    description: 'UUID del usuario final (exactamente 1)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @IsString({ each: true })
  @Matches(UUID_REGEX, { each: true, message: 'Each finalUserId must be a UUID' })
  finalUserIds?: string[];
}
