// documents.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { UploadService } from './upload.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'document-processing' }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, UploadService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
