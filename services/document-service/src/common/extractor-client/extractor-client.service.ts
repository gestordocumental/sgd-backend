import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';
import { CORRELATION_ID_HEADER } from '../middleware/correlation.middleware';

export interface PreviewExtractResult {
  nombre: string | null;
  codigo: string | null;
  version: string | null;
}

@Injectable()
export class ExtractorClientService {
  private readonly extractorUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.extractorUrl = this.config.getOrThrow<string>('METADATA_EXTRACTOR_URL');
  }

  async previewExtract(file: Express.Multer.File, orgName?: string): Promise<PreviewExtractResult> {
    const correlationId = getCorrelationId();
    const url = `${this.extractorUrl}/preview/extract`;

    this.logger.http({
      type: 'internal-request',
      target: 'metadata-extractor-service',
      url,
      correlationId,
      message: `→ [metadata-extractor] POST /preview/extract (${file.originalname})`,
    });

    const form = new FormData();
    form.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    if (orgName) form.append('orgName', orgName);

    try {
      const response = await firstValueFrom(
        this.httpService.post<PreviewExtractResult>(url, form, {
          headers: {
            ...form.getHeaders(),
            [CORRELATION_ID_HEADER]: correlationId,
          },
        }),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'metadata-extractor-service',
        statusCode: 200,
        correlationId,
        message: `← [metadata-extractor] POST /preview/extract 200`,
      });

      return response.data;
    } catch (error: any) {
      const status  = error?.response?.status;
      const message = error?.response?.data?.message ?? error?.message ?? 'Unknown error';

      this.logger.http({
        type: 'internal-response',
        target: 'metadata-extractor-service',
        statusCode: status ?? 500,
        correlationId,
        message: `← [metadata-extractor] POST /preview/extract ${status ?? 500}: ${message}`,
      });

      throw new InternalServerErrorException(
        `Could not extract metadata from metadata-extractor-service: ${message}`,
      );
    }
  }
}
