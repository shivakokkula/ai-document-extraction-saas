import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { firstValueFrom } from 'rxjs';
import { Decimal } from '@prisma/client/runtime/library';

export interface DocumentJobPayload {
  documentId: string;
  organizationId: string;
  s3Bucket: string;
  s3Key: string;
  userId: string;
}

@Processor('document-processing')
@Injectable()
export class DocumentProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessor.name);

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
    private config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<DocumentJobPayload>): Promise<void> {
    const { documentId, organizationId, s3Bucket, s3Key, userId } = job.data;
    this.logger.log(`Processing document: ${documentId}`);

    // Mark as OCR processing
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'ocr_processing' },
    });

    try {
      await job.updateProgress(10);

      // Call AI service
      const aiServiceUrl = this.config.get('aiService.url');
      const { data: extraction } = await firstValueFrom(
        this.httpService.post(`${aiServiceUrl}/api/v1/extract`, {
          document_id: documentId,
          s3_bucket: s3Bucket,
          s3_key: s3Key,
        }, { timeout: 120000 }), // 2 min timeout
      );

      await job.updateProgress(80);

      // Persist results in a transaction
      await this.prisma.$transaction(async (tx) => {
        const fields = extraction.extracted_fields || {};

        await tx.documentExtraction.upsert({
          where: { documentId },
          create: {
            documentId,
            rawText: extraction.raw_text,
            ocrConfidence: extraction.ocr_confidence,
            ocrEngine: extraction.ocr_engine || 'paddleocr',
            extractedFields: fields,
            extractionModel: extraction.extraction_model || 'claude-opus-4-6',
            processingDurationMs: extraction.processing_duration_ms,
            tokenCount: extraction.token_count,
            // Denormalized fields for fast filtering
            vendorName: fields.vendor?.name ?? null,
            invoiceNumber: fields.invoice_number ?? null,
            invoiceDate: fields.invoice_date ? new Date(fields.invoice_date) : null,
            totalAmount: fields.total_amount ? new Decimal(fields.total_amount) : null,
            currency: fields.currency ?? null,
            lineItems: fields.line_items ?? undefined,
            bankName: fields.bank_name ?? null,
            accountNumber: fields.account_number ?? null,
            transactions: fields.transactions ?? undefined,
          },
          update: {
            rawText: extraction.raw_text,
            extractedFields: fields,
            processingDurationMs: extraction.processing_duration_ms,
          },
        });

        await tx.document.update({
          where: { id: documentId },
          data: {
            status: 'completed',
            processedAt: new Date(),
            documentType: extraction.document_type,
            pageCount: extraction.page_count,
          },
        });

        // Increment usage
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        await tx.usageRecord.upsert({
          where: { organizationId_periodStart: { organizationId, periodStart } },
          create: {
            organizationId,
            periodStart,
            periodEnd,
            documentsProcessed: 1,
            pagesProcessed: extraction.page_count || 1,
          },
          update: {
            documentsProcessed: { increment: 1 },
            pagesProcessed: { increment: extraction.page_count || 1 },
          },
        });
      });

      await job.updateProgress(100);
      this.logger.log(`Document completed: ${documentId}`);

    } catch (error) {
      this.logger.error(`Document failed: ${documentId}`, error.message);

      const isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 3) - 1;
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: isFinalAttempt ? 'failed' : 'pending',
          errorMessage: error.message,
          retryCount: { increment: 1 },
        },
      });

      throw error; // BullMQ will retry
    }
  }
}
