import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async register(email: string, password: string, fullName?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const slug = await this.generateOrgSlug(email);

    const org = await this.prisma.organization.create({
      data: {
        name: fullName ? `${fullName}'s Workspace` : 'My Workspace',
        slug,
        users: {
          create: {
            email,
            passwordHash,
            fullName,
            role: 'owner',
            emailVerifyToken: verifyToken,
            emailVerifyExpires: verifyExpires,
          },
        },
        subscriptions: {
          create: {
            plan: 'free',
            status: 'active',
            documentsPerMonth: 10,
            apiCallsPerMonth: 100,
            maxFileSizeMb: 5,
          },
        },
      },
      include: { users: true },
    });

    const user = org.users[0];
    this.logger.log(`User registered: ${email}`);

    // TODO: Send verification email via SendGrid
    // await this.emailService.sendVerificationEmail(email, verifyToken);

    return this.generateTokenPair(user.id, user.email, user.role);
  }

  async login(email: string, password: string, deviceInfo?: object) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (!user.isActive) throw new UnauthorizedException('Account suspended');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.log(`User logged in: ${email}`);
    return this.generateTokenPair(user.id, user.email, user.role, deviceInfo);
  }

  async refreshTokens(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Replay attack detected — revoke ALL tokens for this user
      if (stored) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: stored.userId },
          data: { revokedAt: new Date() },
        });
        this.logger.warn(`Replay attack detected for user: ${stored.userId}`);
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Revoke used token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokenPair(stored.userId, stored.user.email, stored.user.role);
  }

  async logout(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        emailVerifyToken: token,
        emailVerifyExpires: { gt: new Date() },
      },
    });
    if (!user) throw new BadRequestException('Invalid or expired verification token');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpires: null,
      },
    });

    return { message: 'Email verified successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always return success to prevent email enumeration
    if (!user) return { message: 'If that email exists, a reset link was sent' };

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetExpires },
    });

    // TODO: Send reset email
    // await this.emailService.sendPasswordResetEmail(email, resetToken);

    return { message: 'If that email exists, a reset link was sent' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: token,
        resetExpires: { gt: new Date() },
      },
    });
    if (!user) throw new BadRequestException('Invalid or expired reset token');

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetExpires: null,
      },
    });

    // Revoke all refresh tokens (force re-login everywhere)
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { revokedAt: new Date() },
    });

    return { message: 'Password reset successfully' };
  }

  async handleOAuthLogin(
    provider: string,
    providerUserId: string,
    email: string,
    fullName?: string,
    avatarUrl?: string,
  ) {
    // Check if OAuth account exists
    let oauthAccount = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      include: { user: true },
    });

    if (oauthAccount) {
      return this.generateTokenPair(
        oauthAccount.user.id,
        oauthAccount.user.email,
        oauthAccount.user.role,
      );
    }

    // Check if user with this email exists
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Create new user + org
      const slug = await this.generateOrgSlug(email);
      const org = await this.prisma.organization.create({
        data: {
          name: fullName ? `${fullName}'s Workspace` : 'My Workspace',
          slug,
          users: {
            create: {
              email,
              fullName,
              avatarUrl,
              emailVerified: true,
              role: 'owner',
            },
          },
          subscriptions: {
            create: {
              plan: 'free',
              status: 'active',
              documentsPerMonth: 10,
              apiCallsPerMonth: 100,
              maxFileSizeMb: 5,
            },
          },
        },
        include: { users: true },
      });
      user = org.users[0];
    }

    // Link OAuth account
    await this.prisma.oAuthAccount.create({
      data: { userId: user.id, provider, providerUserId },
    });

    return this.generateTokenPair(user.id, user.email, user.role);
  }

  private async generateTokenPair(
    userId: string,
    email: string,
    role: string,
    deviceInfo?: object,
  ) {
    const payload = { sub: userId, email, role };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
      secret: this.config.get('jwt.accessSecret'),
    });

    const rawRefreshToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        deviceInfo: deviceInfo ? (deviceInfo as any) : undefined,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async generateOrgSlug(email: string): Promise<string> {
    const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
    let slug = base;
    let i = 1;
    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`;
    }
    return slug;
  }
}
