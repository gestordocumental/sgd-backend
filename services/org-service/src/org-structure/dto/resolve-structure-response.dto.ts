import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResolvedStructureItem {
  @ApiProperty()
  index!: number;

  @ApiProperty({ format: 'uuid' })
  departamentoId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  areaId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  cargoId!: string | null;
}

export class UnresolvedStructureItem {
  @ApiProperty()
  index!: number;

  @ApiProperty()
  reason!: string;
}

export class ResolveStructureResponseDto {
  @ApiProperty({ type: [ResolvedStructureItem] })
  resolved!: ResolvedStructureItem[];

  @ApiProperty({ type: [UnresolvedStructureItem] })
  unresolved!: UnresolvedStructureItem[];
}
