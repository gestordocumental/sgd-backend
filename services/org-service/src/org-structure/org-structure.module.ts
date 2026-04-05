import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Departamento } from './entities/departamento.entity';
import { Area } from './entities/area.entity';
import { Cargo } from './entities/cargo.entity';
import { DepartamentosService } from './departamentos.service';
import { AreasService } from './areas.service';
import { CargosService } from './cargos.service';
import { DepartamentosController } from './departamentos.controller';
import { AreasController } from './areas.controller';
import { CargosController } from './cargos.controller';
import { OrgCargosController } from './org-cargos.controller';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Departamento, Area, Cargo])],
  controllers: [DepartamentosController, AreasController, CargosController, OrgCargosController],
  providers: [DepartamentosService, AreasService, CargosService, OrgGuard, OrgPermissionsGuard],
  exports: [DepartamentosService, AreasService, CargosService],
})
export class OrgStructureModule {}
