import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private s3: S3Client;
  private bucket: string;

  constructor(private config: ConfigService) {
    this.bucket = config.get('aws.s3Bucket')!;
    const endpoint = config.get('aws.s3Endpoint');

    this.s3 = new S3Client({
      region: config.get('aws.region') || 'ap-south-1',
      credentials: {
        accessKeyId: config.get('aws.accessKeyId')!,
        secretAccessKey: config.get('aws.secretAccessKey')!,
      },
      ...(endpoint && {
        endpoint,
        forcePathStyle: true,
      }),
    });
  }

  async getPresignedUploadUrl(s3Key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ContentType: contentType,
      // Do NOT include ChecksumAlgorithm — it adds CRC32 headers the browser
      // cannot set, causing CORS preflight to fail
    });

    // URL expires in 15 minutes
    return getSignedUrl(this.s3, command, {
      expiresIn: 900,
      // Disable checksum signing — required for direct browser uploads
      unhoistableHeaders: new Set(['x-amz-checksum-crc32', 'x-amz-sdk-checksum-algorithm']),
    });
  }

  async getPresignedDownloadUrl(s3Key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
    return getSignedUrl(this.s3, command, { expiresIn: 3600 });
  }

  async deleteObject(s3Key: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key });
    await this.s3.send(command);
    this.logger.log(`Deleted S3 object: ${s3Key}`);
  }
}
