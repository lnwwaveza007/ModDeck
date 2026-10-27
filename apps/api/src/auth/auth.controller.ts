import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { safeEqual } from './crypto.util';
import {
  SESSION_COOKIE,
  TX_COOKIE,
  parseCookies,
  sessionCookieOptions,
  txCookieOptions,
} from './cookies';
import { CurrentUser } from './current-user.decorator';
import {
  OidcService,
  decodeTx,
  encodeTx,
  sanitizeReturnTo,
} from './oidc.service';
import {
  IdTokenValidationError,
  TokenValidatorService,
} from './token-validator.service';

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

@Controller('auth')
export class AuthController {
  private readonly log = new Logger(AuthController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly validator: TokenValidatorService,
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
  ) {}

  @Get('login')
  login(@Query('returnTo') returnTo: string | undefined, @Res() res: Response) {
    const { url, tx } = this.oidc.start(sanitizeReturnTo(returnTo));
    res.cookie(TX_COOKIE, encodeTx(tx), txCookieOptions(this.cfg));
    res.redirect(url);
  }

  @Get('callback')
  async callback(
    @Query() query: CallbackQuery,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tx = decodeTx(parseCookies(req.headers.cookie)[TX_COOKIE]);
    res.clearCookie(TX_COOKIE, txCookieOptions(this.cfg, false));

    if (query.error) {
      return this.fail(
        res,
        query.error === 'access_denied' ? 'access_denied' : 'sso_error',
      );
    }
    if (
      !tx ||
      typeof query.code !== 'string' ||
      typeof query.state !== 'string' ||
      !safeEqual(query.state, tx.state)
    ) {
      return this.fail(res, 'invalid_state');
    }

    try {
      const idToken = await this.oidc.exchangeCode(query.code, tx.verifier);
      const identity = await this.validator.validateIdToken(idToken, tx.nonce);
      const user = await this.auth.upsertUser(identity);
      const { token, expiresAt } = await this.auth.createSession(user);

      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.cfg, expiresAt));
      return res.redirect(`${this.cfg.appBaseUrl}${tx.returnTo}`);
    } catch (err) {
      if (err instanceof IdTokenValidationError) {
        this.log.warn(`ID token rejected: ${err.reason}`);
        return this.fail(res, 'invalid_token');
      }
      this.log.error('Login failed', err instanceof Error ? err.stack : String(err));
      return this.fail(res, 'login_failed');
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await this.auth.revoke(token);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.cfg));
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  private fail(res: Response, code: string) {
    return res.redirect(`${this.cfg.appBaseUrl}/login?error=${code}`);
  }
}
