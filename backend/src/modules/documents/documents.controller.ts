import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, Res, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { CurrentUser } from '../../common/decorators/index';
import { GetUploadUrlDto } from './dto/get-upload-url.dto';
import { TriggerProcessingDto } from './dto/trigger-processing.dto';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post('upload-url')
  @UseGuards(SubscriptionGuard)
  @ApiOperation({ summary: 'Get a pre-signed S3 URL for direct upload' })
  getUploadUrl(@Body() dto: GetUploadUrlDto, @CurrentUser() user: any) {
    return this.documentsService.getUploadUrl(
      user.organizationId, user.id, dto.filename, dto.fileSize, dto.mimeType,
    );
  }

  @Post()
  @UseGuards(SubscriptionGuard)
  @ApiOperation({ summary: 'Register uploaded document and trigger processing' })
  triggerProcessing(@Body() dto: TriggerProcessingDto, @CurrentUser() user: any) {
    return this.documentsService.triggerProcessing(
      dto.documentId, user.organizationId, user.id,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List documents with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'type', required: false })
  findAll(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.documentsService.findAll(user.organizationId, +page, +limit, status, type);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document with extraction result' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documentsService.findOne(id, user.organizationId);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get processing status' })
  getStatus(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documentsService.getStatus(id, user.organizationId);
  }

  @Get(':id/export')
  @ApiOperation({ summary: 'Export extraction as JSON or CSV' })
  @ApiQuery({ name: 'format', enum: ['json', 'csv'], required: false })
  async export(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('format') format: 'json' | 'csv' = 'json',
    @Res() res: Response,
  ) {
    const result = await this.documentsService.exportExtraction(id, user.organizationId, format);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a document' })
  delete(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documentsService.softDelete(id, user.organizationId);
  }
}
