import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from './upload.service';
import { Decimal } from '@prisma/client/runtime/library';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'];
const MAX_FILE_SIZE_FREE = 5 * 1024 * 1024;   // 5MB
const MAX_FILE_SIZE_PRO  = 50 * 1024 * 1024;  // 50MB

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

    const uploadUrl = await this.uploadService.getPresignedUploadUrl(s3Key, mimeType);

    return { uploadUrl, documentId: document.id, s3Key };
  }

  async triggerProcessing(documentId: string, organizationId: string, userId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
    });
    if (!document) throw new NotFoundException('Document not found');
    if (!['pending', 'failed'].includes(document.status)) {
      throw new BadRequestException('Document already queued or processed');
    }

    const exists = await this.uploadService.objectExists(document.s3Key);
    if (!exists) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'failed', errorMessage: 'File missing in storage. Please re-upload.' },
      });
      throw new BadRequestException('File missing in storage. Please re-upload.');
    }

    const processingMode =
      process.env.DOCUMENT_PROCESSING_MODE ||
      (process.env.NODE_ENV === 'production' ? 'queue' : 'inline');

    if (processingMode === 'inline') {
      this.logger.warn(`Inline processing enabled; bypassing queue for document=${documentId}`);
      this.processInline(documentId, organizationId, document.s3Bucket, document.s3Key, userId)
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

    const job = await this.enqueueWithRetry(
      documentId,
      organizationId,
      userId,
      document.s3Bucket,
      document.s3Key,
      jobId,
    );

    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'queued', jobId: job.id?.toString(), errorMessage: null },
    });

    this.logger.log(`Document queued: ${documentId}, job: ${job.id}`);
    return { documentId, jobId: job.id, status: 'queued' };
  }

  private async processInline(
    documentId: string,
    organizationId: string,
    s3Bucket: string,
    s3Key: string,
    userId: string,
  ) {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'ai_processing', errorMessage: null },
    });

    try {
      const aiServiceUrl = this.config.get<string>('aiService.url');
      this.logger.debug(`Inline AI extraction start: document=${documentId}, aiServiceUrl=${aiServiceUrl}`);

      const response = await fetch(`${aiServiceUrl}/api/v1/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: documentId, s3_bucket: s3Bucket, s3_key: s3Key }),
        signal: AbortSignal.timeout(600_000),
      });

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

  private async enqueueWithRetry(
    documentId: string,
    organizationId: string,
    userId: string,
    s3Bucket: string,
    s3Key: string,
    jobId: string,
  ) {
    let lastError: any;

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
          `Queue enqueue failed for ${documentId}, attempt=${attempt}, code=${code}, message=${error?.message}`,
        );

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

    return {
      data: documents.map((document) => this.serializeDocument(document)),
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
      select: { id: true, status: true, errorMessage: true, processedAt: true, retryCount: true },
    });
    if (!document) throw new NotFoundException('Document not found');
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
}
