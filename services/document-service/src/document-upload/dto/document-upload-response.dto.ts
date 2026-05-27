import { ApiProperty } from '@nestjs/swagger';
import { ExtractionStatus } from '../../typologies/schemas/typology.schema';

export class DocumentUploadResponseDto {
  @ApiProperty({ example: 'Documento cargado. Extraccion de metadata en proceso.' })
  message!: string;

  @ApiProperty({ enum: ExtractionStatus, example: ExtractionStatus.PROCESSING })
  extractionStatus!: string;
}
