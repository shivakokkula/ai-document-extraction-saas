import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private s3: S3Client;
  private bucket: string;
  private requestTimeoutMs: number;

  constructor(private config: ConfigService) {
    this.bucket = config.get('aws.s3Bucket')!;
    const endpoint = config.get('aws.s3Endpoint');
    this.requestTimeoutMs = parseInt(process.env.S3_REQUEST_TIMEOUT_MS || '60000', 10);

    this.s3 = new S3Client({
      region: config.get('aws.region') || 'us-east-1',
      credentials: {
        accessKeyId: config.get('aws.accessKeyId')!,
        secretAccessKey: config.get('aws.secretAccessKey')!,
      },
      ...(endpoint && {
        endpoint,
        forcePathStyle: true, // Required for MinIO
      }),
    });
  }

  async getPresignedUploadUrl(s3Key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ContentType: contentType,
    });
    // URL expires in 15 minutes
    return getSignedUrl(this.s3, command, { expiresIn: 900 });
  }

  async getPresignedDownloadUrl(s3Key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
    return getSignedUrl(this.s3, command, { expiresIn: 3600 }); // 1 hour
  }

  async deleteObject(s3Key: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key });
    await this.sendWithTimeout(command);
    this.logger.log(`Deleted S3 object: ${s3Key}`);
  }

  async objectExists(s3Key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({ Bucket: this.bucket, Key: s3Key });
      await this.sendWithTimeout(command);
      return true;
    } catch (error: any) {
      const name = error?.name || error?.Code || error?.code;
      if (name === 'NotFound' || name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  private async sendWithTimeout(command: any) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.s3.send(command, { abortSignal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}
