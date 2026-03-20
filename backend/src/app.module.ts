import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { TerminusModule } from '@nestjs/terminus';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { BillingModule } from './modules/billing/billing.module';
import { QueueModule } from './modules/queue/queue.module';
import { HealthController } from './modules/health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }]),

    // Upstash Redis + BullMQ
    // Upstash provides a standard Redis-compatible URL — BullMQ works out of the box
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('redis.url') || '';
        const usesTls = redisUrl.startsWith('rediss://');
        const logger = new Logger('RedisConfig');
        if (!redisUrl) {
          logger.error('REDIS_URL is not set. Queueing will fail in production.');
        } else {
          try {
            const parsed = new URL(redisUrl);
            logger.log(`Redis configured: scheme=${parsed.protocol.replace(':', '')}, host=${parsed.hostname}`);
          } catch {
            logger.warn('REDIS_URL is set but could not be parsed.');
          }
        }

        return {
          connection: {
            url: redisUrl,
            // Upstash URLs use rediss:// and require TLS in every environment.
            tls: usesTls ? {} : undefined,
            maxRetriesPerRequest: null, // Required by BullMQ
            enableReadyCheck: false,
            connectTimeout: 10000,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { count: 500, age: 86400 },
            removeOnFail: { count: 1000, age: 604800 },
          },
        };
      },
    }),

    TerminusModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    DocumentsModule,
    BillingModule,
    QueueModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
