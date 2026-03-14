import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from './upload.service';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'];

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private uploadService: UploadService,
    @InjectQueue('document-processing') private docQueue: Queue,
  ) {}

  async getUploadUrl(
    organizationId: string,
    userId: string,
    filename: string,
    fileSize: number,
    mimeType: string,
  ) {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: ['active', 'trialing'] } },
    });
    const maxBytes = (subscription?.maxFileSizeMb ?? 5) * 1024 * 1024;
    if (fileSize > maxBytes) {
      throw new BadRequestException(
        `File too large. Max allowed: ${subscription?.maxFileSizeMb ?? 5}MB`,
      );
    }

    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `${organizationId}/${userId}/${Date.now()}-${safeFilename}`;

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
    if (document.status !== 'pending') {
      throw new BadRequestException('Document already queued or processed');
    }

    try {
      const job = await this.docQueue.add(
        'process-document',
        { documentId, organizationId, s3Bucket: document.s3Bucket, s3Key: document.s3Key, userId },
        { jobId: `doc-${documentId}` },
      );

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'queued', jobId: job.id?.toString() },
      });

      this.logger.log(`Document queued: ${documentId}`);
      return { documentId, jobId: job.id, status: 'queued' };

    } catch (error: any) {
      // If Redis/queue is unavailable, still save the document — mark as pending
      // so it can be retried later
      this.logger.error(`Failed to queue document ${documentId}: ${error.message}`);
      return { documentId, jobId: null, status: 'pending', warning: 'Queue unavailable — will retry' };
    }
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
              id: true,
              vendorName: true,
              invoiceNumber: true,
              totalAmount: true,
              currency: true,
              invoiceDate: true,
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
      data: documents,
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
    return document;
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
        } else {
          rows.push(`"${key}","${String(v ?? '').replace(/"/g, '""')}"`);
        }
      }
    };
    flatten(obj, prefix);
    return rows.join('\n');
  }
}
