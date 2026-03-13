import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    const ROLE_HIERARCHY = { owner: 4, admin: 3, member: 2, viewer: 1 };
    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    const required = Math.max(...requiredRoles.map((r) => ROLE_HIERARCHY[r] ?? 0));

    if (userLevel < required) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
