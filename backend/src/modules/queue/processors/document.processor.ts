import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
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
    private config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<DocumentJobPayload>): Promise<void> {
    const { documentId, organizationId, s3Bucket, s3Key, userId } = job.data;
    this.logger.log(
      `Processing document: id=${documentId}, jobId=${job.id}, attemptsMade=${job.attemptsMade}, maxAttempts=${job.opts.attempts ?? 3}`,
    );
    this.logger.debug(
      `Document payload: org=${organizationId}, user=${userId}, bucket=${s3Bucket}, key=${s3Key}`,
    );

    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'ai_processing' },
    });

    try {
      await job.updateProgress(10);

      const aiServiceUrl = this.config.get('aiService.url');
      this.logger.debug(`Calling AI service for ${documentId}: ${aiServiceUrl}/api/v1/extract`);
      const response = await fetch(`${aiServiceUrl}/api/v1/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: documentId, s3_bucket: s3Bucket, s3_key: s3Key }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `AI service failed for ${documentId}: status=${response.status}, body=${errorBody.slice(0, 500)}`,
        );
        throw new Error(`AI service error: ${response.status} ${errorBody}`);
      }

      const extraction = await response.json() as any;
      this.logger.debug(
        `AI extraction received for ${documentId}: docType=${extraction.document_type}, pages=${extraction.page_count}, tokens=${extraction.token_count}`,
      );
      await job.updateProgress(80);

      await this.prisma.$transaction(async (tx) => {
        const fields = extraction.extracted_fields || {};

        await tx.documentExtraction.upsert({
          where: { documentId },
          create: {
            documentId,
            rawText: extraction.raw_text,
            ocrConfidence: extraction.ocr_confidence,
            ocrEngine: extraction.ocr_engine || 'tesseract',
            extractedFields: fields,
            extractionModel: extraction.extraction_model || 'gemini-2.5-flash',
            processingDurationMs: extraction.processing_duration_ms,
            tokenCount: extraction.token_count,
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
      });

      try {
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        await this.prisma.usageRecord.upsert({
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
      } catch (error: any) {
        this.logger.warn(`Usage record update failed: org=${organizationId}, message=${error?.message}`);
      }

      await job.updateProgress(100);
      this.logger.log(`Document completed: ${documentId}`);

    } catch (error: any) {
      this.logger.error(
        `Document failed: id=${documentId}, jobId=${job.id}, attemptsMade=${job.attemptsMade}, message=${error?.message}`,
      );
      const isFinalAttempt = job.attemptsMade >= ((job.opts.attempts ?? 3) - 1);
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: isFinalAttempt ? 'failed' : 'pending',
          errorMessage: error.message,
          retryCount: { increment: 1 },
        },
      });
      throw error;
    }
  }
}
