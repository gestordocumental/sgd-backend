import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkStructureRowError {
  @ApiProperty() row!: number;
  @ApiProperty() department!: string;
  @ApiPropertyOptional() area?: string;
  @ApiPropertyOptional() position?: string;
  @ApiProperty() reason!: string;
}

export class BulkStructureResponseDto {
  @ApiProperty() totalRows!: number;
  @ApiProperty() departmentsCreated!: number;
  @ApiProperty() departmentsExisting!: number;
  @ApiProperty() areasCreated!: number;
  @ApiProperty() areasExisting!: number;
  @ApiProperty() positionsCreated!: number;
  @ApiProperty() positionsExisting!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [BulkStructureRowError] }) errors!: BulkStructureRowError[];
}
