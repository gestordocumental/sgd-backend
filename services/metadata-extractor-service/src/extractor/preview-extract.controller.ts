import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { extractStructured } from './parsers/parser.factory';
import { MetadataRulesService } from './rules/metadata-rules.service';

@ApiTags('Preview')
@Controller('preview')
export class PreviewExtractController {
  constructor(private readonly rules: MetadataRulesService) {}

  @ApiOperation({
    summary: 'Synchronous metadata extraction — internal use only',
    description: 'Accepts a PDF/DOCX file and returns extracted nombre, codigo and version without persisting anything.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, orgName: { type: 'string' } } } })
  @ApiOkResponse({ schema: { example: { nombre: 'Política de Seguridad', codigo: 'POL-SEG-001', version: 'v1.0' } } })
  @Post('extract')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async extract(
    @UploadedFile() file: Express.Multer.File,
    @Body('orgName') orgName?: string,
  ): Promise<{ nombre: string | null; codigo: string | null; version: string | null }> {
    if (!file) throw new BadRequestException('No se proporcionó ningún archivo');

    const structured = await extractStructured(file.buffer, file.mimetype);

    if (structured === null) {
      return { nombre: null, codigo: null, version: null };
    }

    if (structured.text.trim().length === 0) {
      return { nombre: null, codigo: null, version: null };
    }

    return this.rules.extract({
      text:      structured.text,
      titleCell: structured.titleCell,
      leftCell:  structured.leftCell,
      rightCell: structured.rightCell,
      orgName:   orgName ?? null,
    });
  }
}
