import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TriggerProcessingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  documentId: string;
}
