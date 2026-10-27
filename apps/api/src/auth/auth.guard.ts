import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import type { AuthedRequest } from './auth.types';
import { SESSION_COOKIE, parseCookies, sessionCookieOptions } from './cookies';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();

    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException();

    const result = await this.auth.authenticate(token);
    if (!result) throw new UnauthorizedException();

    req.user = result.user;
    if (result.renewedExpiresAt) {
      res.cookie(
        SESSION_COOKIE,
        token,
        sessionCookieOptions(this.cfg, result.renewedExpiresAt),
      );
    }
    return true;
  }
}
