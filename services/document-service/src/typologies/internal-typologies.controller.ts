import {
  Controller,
  Get,
  Param,
  UnauthorizedException,
  Req,
  OnModuleInit,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { TypologiesService } from './typologies.service';

@Controller('internal/typologies')
export class InternalTypologiesController implements OnModuleInit {
  private internalToken!: string;

  constructor(private readonly typologiesService: TypologiesService) {}

  onModuleInit() {
    const token = process.env['INTERNAL_TOKEN'];
    if (!token) throw new Error('INTERNAL_TOKEN env var is not set');
    this.internalToken = token;
  }

  @Get(':id/public-info')
  async getPublicInfo(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const provided = req.headers['x-internal-token'];
    if (typeof provided !== 'string') throw new UnauthorizedException('Missing internal token');

    const expected = Buffer.from(this.internalToken);
    const buf = Buffer.from(provided);
    if (buf.length !== expected.length || !timingSafeEqual(expected, buf)) {
      throw new UnauthorizedException('Invalid internal token');
    }

    const doc = await this.typologiesService.findByIdPublic(id);

    return {
      id: (doc._id as { toString(): string }).toString(),
      nombre: doc.datosDeclarados.nombre,
      codigo: doc.datosDeclarados.codigo,
      version: doc.datosDeclarados.version,
      estructuraOrg: {
        departamentoId:    doc.estructuraOrg.departamentoId,
        departamentoNombre: doc.estructuraOrg.departamentoNombre,
        areaId:            doc.estructuraOrg.areaId,
        areaNombre:        doc.estructuraOrg.areaNombre,
        cargoId:           doc.estructuraOrg.cargoId,
        cargoNombre:       doc.estructuraOrg.cargoNombre,
      },
    };
  }
}
