import { ApiProperty } from '@nestjs/swagger';

export class WorkflowFileUploadResponseDto {
  @ApiProperty({ description: 'Clave de almacenamiento en MinIO/R2' })
  storageKey!: string;

  @ApiProperty() originalName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() fileSizeBytes!: number;
}
