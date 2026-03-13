import { IsString, IsNumber, IsNotEmpty, IsIn, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetUploadUrlDto {
  @ApiProperty({ example: 'invoice-jan-2025.pdf' })
  @IsString()
  @IsNotEmpty()
  filename: string;

  @ApiProperty({ example: 1048576 })
  @IsNumber()
  @Min(1)
  @Max(200 * 1024 * 1024) // 200MB absolute max
  fileSize: number;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @IsIn(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'])
  mimeType: string;
}

export class TriggerProcessingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  documentId: string;
}
