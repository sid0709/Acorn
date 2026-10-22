import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { autoBidFullName } from '../personal/lib/auto-bid-full-name';
import { PrismaService } from '../prisma/prisma.service';
import { LensSessionService } from './lens-session.service';

@Injectable()
export class LensAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: LensSessionService,
  ) {}

  async signIn(usernameRaw: string, password: string) {
    const username = String(usernameRaw || '').trim();
    if (!username || !password) {
      throw new UnauthorizedException({
        success: false,
        code: 'MISSING_CREDENTIALS',
        message: 'Username and vendor access password are required',
      });
    }
    if (username.length > 200) {
      throw new UnauthorizedException({
        success: false,
        code: 'INVALID_USERNAME',
        message: 'Enter a valid username',
      });
    }

    const account = await this.findAccount(username);
    if (!account) {
      throw new UnauthorizedException({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or vendor access password',
      });
    }
    if (!account.vendorAllowed) {
      throw new ForbiddenException({
        success: false,
        code: 'VENDOR_ACCESS_OFF',
        message: 'Vendor access is not enabled for this profile.',
      });
    }
    if (!account.vendorPassword) {
      throw new ForbiddenException({
        success: false,
        code: 'VENDOR_PASSWORD_UNSET',
        message: 'Set a vendor access password in Athens before signing in.',
      });
    }
    const match = await bcrypt.compare(password, account.vendorPassword);
    if (!match) {
      throw new UnauthorizedException({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or vendor access password',
      });
    }

    const result = await this.sessions.create({
      accountId: account.id,
      applierName: account.name,
      username: account.name,
    });

    return {
      success: true as const,
      session: {
        username: result.session.username,
        displayName: autoBidFullName(account.autoBidProfile, account.name),
        profileId: result.session.accountId,
        authenticatedAt: result.session.authenticatedAt,
        expiresAt: result.session.expiresAt,
        accessToken: result.token,
      },
    };
  }

  async signOut(token: string) {
    await this.sessions.revoke(token);
    return { success: true as const };
  }

  private async findAccount(username: string) {
    const exact = await this.prisma.accountInfo.findUnique({
      where: { name: username },
      select: {
        id: true,
        name: true,
        vendorAllowed: true,
        vendorPassword: true,
        autoBidProfile: true,
      },
    });
    if (exact) return exact;
    const all = await this.prisma.accountInfo.findMany({
      select: {
        id: true,
        name: true,
        vendorAllowed: true,
        vendorPassword: true,
        autoBidProfile: true,
      },
      take: 500,
    });
    const lower = username.toLowerCase();
    return all.find((a) => a.name.toLowerCase() === lower) ?? null;
  }
}
