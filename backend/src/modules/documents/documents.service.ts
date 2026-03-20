import {
  Injectable, NotFoundException, BadRequestException, Logger, HttpException, InternalServerErrorException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from './upload.service';
import { Decimal } from '@prisma/client/runtime/library';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'];
const ACTIVE_STATUSES = new Set(['pending', 'queued', 'ocr_processing', 'ai_processing']);
const PROCESSING_TIMEOUT_MINUTES = parseInt(process.env.PROCESSING_TIMEOUT_MINUTES || '10', 10);

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private static readonly QUEUE_ENQUEUE_ATTEMPTS = 3;
  private static readonly QUEUE_RETRY_DELAY_MS = 500;

  constructor(
    private prisma: PrismaService,
    private uploadService: UploadService,
    private config: ConfigService,
    @InjectQueue('document-processing') private docQueue: Queue,
  ) {}

  async getUploadUrl(
    organizationId: string,
    userId: string,
    filename: string,
    fileSize: number,
    mimeType: string,
  ) {
    // Validate mime type
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }

    // Check subscription file size limit
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: ['active', 'trialing'] } },
    });
    const maxBytes = (subscription?.maxFileSizeMb ?? 5) * 1024 * 1024;
    if (fileSize > maxBytes) {
      throw new BadRequestException(
        `File too large. Max allowed: ${subscription?.maxFileSizeMb ?? 5}MB`,
      );
    }

    // Pre-create document record
    const s3Key = `${organizationId}/${userId}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const document = await this.prisma.document.create({
      data: {
        organizationId,
        uploadedBy: userId,
        originalFilename: filename,
        s3Key,
        s3Bucket: process.env.AWS_S3_BUCKET!,
        fileSizeBytes: fileSize,
        mimeType,
        status: 'pending',
      },
    });

    let uploadUrl: string;
    try {
      uploadUrl = await this.uploadService.getPresignedUploadUrl(s3Key, mimeType);
    } catch (error: any) {
      this.logger.error(
        `Presigned URL generation failed: doc=${document.id}, s3Key=${s3Key}, message=${error?.message}`,
      );
      throw error;
    }

    return { uploadUrl, documentId: document.id, s3Key };
  }

  async triggerProcessing(documentId: string, organizationId: string, userId: string) {
    const startMs = Date.now();
    this.logger.log(
      `Trigger processing start: document=${documentId}, org=${organizationId}, user=${userId}`,
    );
    try {
      const document = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
      });
      if (!document) throw new NotFoundException('Document not found');
      if (!['pending', 'failed'].includes(document.status)) {
        throw new BadRequestException('Document already queued or processed');
      }

      const exists = await this.uploadService.objectExists(document.s3Key);
      this.logger.debug(
        `Storage existence check: document=${documentId}, exists=${exists}, key=${document.s3Key}`,
      );
      if (!exists) {
        this.logger.warn(
          `Upload missing in storage: document=${documentId}, s3Key=${document.s3Key}, bucket=${document.s3Bucket}`,
        );
        await this.prisma.document.update({
          where: { id: documentId },
          data: { status: 'failed', errorMessage: 'File missing in storage. Please re-upload.' },
        });
        throw new BadRequestException('File missing in storage. Please re-upload.');
      }

      const processingMode =
        process.env.DOCUMENT_PROCESSING_MODE ||
        (process.env.NODE_ENV === 'production' ? 'queue' : 'inline');
      this.logger.log(
        `Processing mode resolved: document=${documentId}, mode=${processingMode}, elapsedMs=${Date.now() - startMs}`,
      );

      if (processingMode === 'inline') {
        this.logger.warn(`Inline processing enabled; bypassing queue for document=${documentId}`);
        this.processInline(documentId, organizationId, document.s3Bucket, document.s3Key)
          .catch((error) => {
            this.logger.error(`Inline processing background error: document=${documentId}, message=${error?.message}`);
          });
        return { documentId, status: 'processing', mode: 'inline' };
      }

      // Use a unique job id per enqueue so manual retries can run even when a previous
      // failed/completed job for the same document is still retained in BullMQ.
      const jobId = `doc-${documentId}-${Date.now()}`;
      this.logger.debug(
        `Queueing document: ${documentId}, status=${document.status}, retryCount=${document.retryCount}, jobId=${jobId}`,
      );

      const enqueueStart = Date.now();
      const job = await this.enqueueWithRetry(
        documentId,
        organizationId,
        userId,
        document.s3Bucket,
        document.s3Key,
        jobId,
      );
      this.logger.log(
        `Queue enqueue completed: document=${documentId}, jobId=${job.id}, elapsedMs=${Date.now() - enqueueStart}`,
      );

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'queued', jobId: job.id?.toString(), errorMessage: null },
      });

      this.logger.log(
        `Document queued: document=${documentId}, job=${job.id}, totalElapsedMs=${Date.now() - startMs}`,
      );
      return { documentId, jobId: job.id, status: 'queued' };
    } catch (error: any) {
      const message = error?.message || 'Unknown error';
      this.logger.error(
        `Trigger processing failed: document=${documentId}, org=${organizationId}, user=${userId}, message=${message}`,
      );
      const status = typeof error?.getStatus === 'function' ? error.getStatus() : undefined;
      if (!status || status >= 500) {
        try {
          await this.prisma.document.update({
            where: { id: documentId },
            data: { status: 'failed', errorMessage: message },
          });
        } catch (updateError: any) {
          this.logger.warn(
            `Failed to persist error state: document=${documentId}, message=${updateError?.message}`,
          );
        }
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to queue document');
    }
  }

  private async processInline(
    documentId: string,
    organizationId: string,
    s3Bucket: string,
    s3Key: string,
  ) {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'ai_processing', errorMessage: null },
    });

    try {
      const aiServiceUrl = this.config.get<string>('aiService.url');
      this.logger.debug(`Inline AI extraction start: document=${documentId}, aiServiceUrl=${aiServiceUrl}`);

      const response = await this.fetchAiWithRetry(
        `${aiServiceUrl}/api/v1/extract`,
        { document_id: documentId, s3_bucket: s3Bucket, s3_key: s3Key },
        documentId,
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`AI service error: ${response.status} ${errorBody}`);
      }

      const extraction = await response.json() as any;

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

      await this.updateUsageRecordSafe(organizationId, extraction.page_count || 1);
      this.logger.log(`Inline processing completed: document=${documentId}`);
    } catch (error: any) {
      this.logger.error(`Inline processing failed: document=${documentId}, message=${error?.message}`);
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'failed',
          errorMessage: error?.message ?? 'Unknown inline processing error',
          retryCount: { increment: 1 },
        },
      });
      throw error;
    }
  }

  private async updateUsageRecordSafe(organizationId: string, pagesProcessed: number) {
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
          pagesProcessed,
        },
        update: {
          documentsProcessed: { increment: 1 },
          pagesProcessed: { increment: pagesProcessed },
        },
      });
    } catch (error: any) {
      this.logger.warn(`Usage record update failed: org=${organizationId}, message=${error?.message}`);
    }
  }

  private async fetchAiWithRetry(
    url: string,
    payload: Record<string, any>,
    documentId: string,
  ) {
    const maxAttempts = 3;
    const baseDelayMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(600_000),
        });

        if (response.status === 502 || response.status === 503 || response.status === 504) {
          this.logger.warn(
            `AI service retryable response: document=${documentId}, status=${response.status}, attempt=${attempt}`,
          );
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
            continue;
          }
        }

        this.logger.log(
          `AI service response received: document=${documentId}, status=${response.status}, elapsedMs=${Date.now() - attemptStart}`,
        );
        return response;
      } catch (error: any) {
        this.logger.warn(
          `AI service request failed: document=${documentId}, attempt=${attempt}, message=${error?.message}`,
        );
        if (attempt >= maxAttempts) {
          throw error;
        }
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
    throw new Error('AI service request failed after retries');
  }

  private async enqueueWithRetry(
    documentId: string,
    organizationId: string,
    userId: string,
    s3Bucket: string,
    s3Key: string,
    jobId: string,
  ) {
    let lastError: any;
    const redisUrl = this.config.get<string>('redis.url') || '';
    const redisUrlSet = Boolean(redisUrl);

    for (let attempt = 1; attempt <= DocumentsService.QUEUE_ENQUEUE_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          this.logger.warn(
            `Retrying queue enqueue for ${documentId}, attempt=${attempt}/${DocumentsService.QUEUE_ENQUEUE_ATTEMPTS}`,
          );
        }

        return await this.docQueue.add(
          'process-document',
          { documentId, organizationId, s3Bucket, s3Key, userId },
          { jobId },
        );
      } catch (error: any) {
        lastError = error;
        const code = error?.code || error?.cause?.code;
        const isTransient =
          code === 'ECONNRESET' ||
          code === 'ETIMEDOUT' ||
          code === 'ECONNREFUSED' ||
          code === 'EPIPE' ||
          code === 'NR_CLOSED';

        this.logger.error(
          `Queue enqueue failed for ${documentId}, attempt=${attempt}, code=${code}, message=${error?.message}, redisUrlSet=${redisUrlSet}`,
        );
        if (error?.stack) {
          this.logger.debug(`Queue enqueue stack: document=${documentId}, stack=${error.stack}`);
        }

        if (!isTransient || attempt === DocumentsService.QUEUE_ENQUEUE_ATTEMPTS) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, DocumentsService.QUEUE_RETRY_DELAY_MS * attempt));
      }
    }

    throw lastError;
  }

  async findAll(organizationId: string, page = 1, limit = 20, status?: string, type?: string) {
    const where: any = { organizationId, deletedAt: null };
    if (status) where.status = status;
    if (type) where.documentType = type;

    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: {
          extraction: {
            select: {
              id: true, vendorName: true, invoiceNumber: true,
              totalAmount: true, currency: true, invoiceDate: true,
            },
          },
          uploader: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document.count({ where }),
    ]);

    const { updatedIds } = await this.failStaleDocuments(documents);

    return {
      data: documents.map((document) => {
        if (updatedIds.has(document.id)) {
          return this.serializeDocument({ ...document, status: 'failed', errorMessage: 'Processing timed out. Please retry.' });
        }
        return this.serializeDocument(document);
      }),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, organizationId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        extraction: true,
        uploader: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!document) throw new NotFoundException('Document not found');
    return this.serializeDocument(document);
  }

  async getStatus(id: string, organizationId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true, errorMessage: true, processedAt: true, retryCount: true, updatedAt: true },
    });
    if (!document) throw new NotFoundException('Document not found');
    if (this.isStale(document.status, document.processedAt ?? undefined, (document as any).updatedAt)) {
      await this.prisma.document.update({
        where: { id },
        data: { status: 'failed', errorMessage: 'Processing timed out. Please retry.' },
      });
      return { ...document, status: 'failed', errorMessage: 'Processing timed out. Please retry.' };
    }
    return document;
  }

  async softDelete(id: string, organizationId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!document) throw new NotFoundException('Document not found');
    await this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { message: 'Document deleted' };
  }

  async exportExtraction(id: string, organizationId: string, format: 'json' | 'csv') {
    const document = await this.findOne(id, organizationId);
    if (!document.extraction) throw new BadRequestException('Document not yet processed');

    if (format === 'json') {
      return {
        contentType: 'application/json',
        filename: `${document.originalFilename}-extraction.json`,
        data: JSON.stringify(document.extraction.extractedFields, null, 2),
      };
    }

    // CSV export — flatten extracted fields
    const fields = document.extraction.extractedFields as Record<string, any>;
    const rows = this.flattenToCSV(fields);
    return {
      contentType: 'text/csv',
      filename: `${document.originalFilename}-extraction.csv`,
      data: rows,
    };
  }

  private flattenToCSV(obj: Record<string, any>, prefix = ''): string {
    const rows: string[] = ['field,value'];
    const flatten = (o: any, p: string) => {
      for (const [k, v] of Object.entries(o)) {
        const key = p ? `${p}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          flatten(v, key);
        } else if (Array.isArray(v)) {
          rows.push(`"${key}","${JSON.stringify(v).replace(/"/g, '""')}"`);
        } else {
          rows.push(`"${key}","${String(v ?? '').replace(/"/g, '""')}"`);
        }
      }
    };
    flatten(obj, prefix);
    return rows.join('\n');
  }

  private serializeDocument<T extends { fileSizeBytes: bigint }>(document: T) {
    return {
      ...document,
      // Prisma returns BigInt here, which Express cannot JSON.stringify directly.
      fileSizeBytes: Number(document.fileSizeBytes),
    };
  }

  private isStale(status: string, processedAt?: Date, updatedAt?: Date) {
    if (!ACTIVE_STATUSES.has(status)) return false;
    if (processedAt) return false;
    if (!updatedAt) return false;
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    return ageMs > PROCESSING_TIMEOUT_MINUTES * 60 * 1000;
  }

  private async failStaleDocuments(docs: Array<any>) {
    const staleIds = docs
      .filter((doc) => this.isStale(doc.status, doc.processedAt, doc.updatedAt))
      .map((doc) => doc.id);

    if (staleIds.length === 0) {
      return { updatedIds: new Set<string>() };
    }

    await this.prisma.document.updateMany({
      where: { id: { in: staleIds } },
      data: { status: 'failed', errorMessage: 'Processing timed out. Please retry.' },
    });

    return { updatedIds: new Set(staleIds) };
  }
}
