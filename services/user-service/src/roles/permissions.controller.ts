import { Controller, Get } from '@nestjs/common';
import { PermissionsService } from './permissions.service';

@Controller('api/permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  // Returns all available permissions — orgs use this list to build custom roles
  @Get()
  findAll() {
    return this.permissionsService.findAll();
  }
}
