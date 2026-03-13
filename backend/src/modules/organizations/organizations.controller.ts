import { Controller, Get, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsOptional, IsString, IsEmail } from 'class-validator';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/index';

class UpdateOrgDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEmail() billingEmail?: string;
}

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private orgService: OrganizationsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current organization' })
  getMyOrg(@CurrentUser() user: any) {
    return this.orgService.findById(user.organizationId);
  }

  @Patch('me')
  @Roles('admin', 'owner')
  @ApiOperation({ summary: 'Update organization' })
  updateOrg(@CurrentUser() user: any, @Body() dto: UpdateOrgDto) {
    return this.orgService.update(user.organizationId, dto);
  }

  @Get('me/members')
  @ApiOperation({ summary: 'List organization members' })
  listMembers(@CurrentUser() user: any) {
    return this.orgService.listMembers(user.organizationId);
  }

  @Delete('me/members/:userId')
  @Roles('admin', 'owner')
  @ApiOperation({ summary: 'Remove a member' })
  removeMember(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.orgService.removeMember(user.organizationId, userId, user.id);
  }
}
