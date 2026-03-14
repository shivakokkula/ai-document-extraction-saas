import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DocumentProcessor } from './processors/document.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'document-processing' }),
  ],
  providers: [DocumentProcessor],
})
export class QueueModule {}
