import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResolveDiscrepancyDto, ResolveAction } from './resolve-discrepancy.dto';

describe('ResolveDiscrepancyDto', () => {
  it('trims nombre/codigo/version on MANUAL_OVERRIDE', async () => {
    const dto = plainToInstance(ResolveDiscrepancyDto, {
      action: ResolveAction.MANUAL_OVERRIDE,
      nombre: '  Formato de entrega de Feedback  ',
      codigo: '  D-MS-F-012  ',
      version: '  01  ',
    });

    expect(dto.nombre).toBe('Formato de entrega de Feedback');
    expect(dto.codigo).toBe('D-MS-F-012');
    expect(dto.version).toBe('01');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('validates ADOPT_EXTRACTED with no nombre/codigo/version provided', async () => {
    const dto = plainToInstance(ResolveDiscrepancyDto, { action: ResolveAction.ADOPT_EXTRACTED });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
