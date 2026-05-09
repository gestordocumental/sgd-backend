import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsInt,
  MaxLength,
  MinLength,
  IsPositive,
  Matches,
} from 'class-validator';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_EACH = { each: true, message: 'Each finalUserId must be a UUID' };

export class ApproverStepDto {
  @ApiProperty({ format: 'uuid', description: 'UUID del usuario aprobador' })
  @IsString()
  @Matches(UUID_REGEX, { message: 'userId must be a UUID' })
  userId!: string;

  @ApiProperty({ minimum: 1, description: 'Orden de aprobación (1 = primero)' })
  @IsInt()
  @IsPositive()
  stepOrder!: number;
}

export class WorkflowFileDto {
  @ApiProperty({ description: 'Clave de almacenamiento en MinIO/R2 (devuelta por /workflow-files)' })
  @IsString()
  @MaxLength(500)
  storageKey!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  originalName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  mimeType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  fileSizeBytes?: number;
}

export class CreateWorkflowDto {
  @ApiProperty({ maxLength: 500, description: 'Título del workflow' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  title!: string;

  @ApiPropertyOptional({ description: 'Descripción opcional del workflow' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  description?: string;

  @ApiProperty({
    description: 'MongoDB ObjectId de la tipología en document-service',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  @MinLength(24)
  @MaxLength(24)
  typologyId!: string;

  @ApiProperty({
    type: [ApproverStepDto],
    description: 'Usuarios aprobadores con su orden. Mínimo 1.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApproverStepDto)
  approvers!: ApproverStepDto[];

  @ApiPropertyOptional({
    type: WorkflowFileDto,
    description: 'Documento principal ya validado y subido a document-service',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowFileDto)
  mainDocument?: WorkflowFileDto;

  @ApiPropertyOptional({
    type: [WorkflowFileDto],
    description: 'Adjuntos de soporte ya subidos a document-service',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowFileDto)
  attachments?: WorkflowFileDto[];

  @ApiProperty({
    type: [String],
    description: 'UUIDs de los usuarios finales seleccionados al crear el workflow (mínimo 1)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @IsString({ each: true })
  @Matches(UUID_REGEX, UUID_EACH)
  finalUserIds!: string[];
}
