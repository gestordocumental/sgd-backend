import { ApiProperty } from '@nestjs/swagger';

export class SignedUrlResponseDto {
  @ApiProperty({
    example: 'https://storage.example.com/signed/document.pdf?signature=abc123',
  })
  signedUrl!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;
}
