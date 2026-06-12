import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppLogger, KafkaModule, InternalGuard } from '@sgd/common';
import { Departamento } from './entities/departamento.entity';
import { Area } from './entities/area.entity';
import { Cargo } from './entities/cargo.entity';
import { DepartamentosService } from './departamentos.service';
import { AreasService } from './areas.service';
import { CargosService } from './cargos.service';
import { BulkStructureService } from './bulk-structure.service';
import { DepartamentosController } from './departamentos.controller';
import { AreasController } from './areas.controller';
import { CargosController } from './cargos.controller';
import { OrgCargosController } from './org-cargos.controller';
import { OrgAreasController } from './org-areas.controller';
import { DeptCargosController } from './dept-cargos.controller';
import { BulkStructureController } from './bulk-structure.controller';
import { InternalStructureController } from './internal-structure.controller';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Departamento, Area, Cargo]), KafkaModule],
  controllers: [
    DepartamentosController,
    AreasController,
    CargosController,
    OrgCargosController,
    OrgAreasController,
    DeptCargosController,
    BulkStructureController,
    InternalStructureController,
  ],
  providers: [
    AppLogger,
    DepartamentosService,
    AreasService,
    CargosService,
    BulkStructureService,
    OrgGuard,
    OrgPermissionsGuard,
    InternalGuard,
  ],
  exports: [DepartamentosService, AreasService, CargosService],
})
export class OrgStructureModule {}
