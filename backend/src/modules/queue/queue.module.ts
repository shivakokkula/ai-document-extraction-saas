import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { DocumentProcessor } from './processors/document.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'document-processing' }),
    HttpModule,
  ],
  providers: [DocumentProcessor],
})
export class QueueModule {}
