import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class BulkImportErrorResponseDto {
  @ApiProperty()
  row!: number;

  @ApiPropertyOptional()
  department?: string;

  @ApiPropertyOptional()
  area?: string;

  @ApiPropertyOptional()
  position?: string;

  @ApiPropertyOptional()
  nombre?: string;

  @ApiPropertyOptional()
  codigo?: string;

  @ApiProperty()
  reason!: string;
}

export class BulkImportResponseDto {
  @ApiProperty()
  totalRows!: number;

  @ApiProperty()
  created!: number;

  @ApiProperty()
  failed!: number;

  @ApiProperty({ type: [BulkImportErrorResponseDto] })
  errors!: BulkImportErrorResponseDto[];
}
