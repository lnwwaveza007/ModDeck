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
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AUTH_CONFIG, type AuthConfig, requireSso } from "./auth.config";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import type { AuthUser } from "./auth.types";
import { safeEqual } from "./crypto.util";
import {
  SESSION_COOKIE,
  TX_COOKIE,
  parseCookies,
  sessionCookieOptions,
  txCookieOptions,
} from "./cookies";
import { CurrentUser } from "./current-user.decorator";
import { OidcService, decodeTx, encodeTx, sanitizeReturnTo } from "./oidc.service";
import { IdTokenValidationError, TokenValidatorService } from "./token-validator.service";

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

@Controller("auth")
export class AuthController {
  private readonly log = new Logger(AuthController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly validator: TokenValidatorService,
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
  ) {}

  @Get("login")
  login(@Query("returnTo") returnTo: string | undefined, @Res() res: Response) {
    const safeReturnTo = sanitizeReturnTo(returnTo);
    // A student on the join page gets the guest option back instead of a 503.
    const join = joinPath(safeReturnTo);
    if (!this.cfg.sso && join) return res.redirect(`${join}?sso_error=sso_unavailable`);
    const { url, tx } = this.oidc.start(safeReturnTo);
    res.cookie(TX_COOKIE, encodeTx(tx), txCookieOptions(this.cfg));
    res.redirect(url);
  }

  @Get("callback")
  async callback(@Query() query: CallbackQuery, @Req() req: Request, @Res() res: Response) {
    const sso = requireSso(this.cfg);
    const tx = decodeTx(parseCookies(req.headers.cookie)[TX_COOKIE]);
    res.clearCookie(TX_COOKIE, txCookieOptions(this.cfg, false));

    if (query.error) {
      return this.fail(
        res,
        sso.appBaseUrl,
        tx?.returnTo,
        query.error === "access_denied" ? "access_denied" : "sso_error",
      );
    }
    if (
      !tx ||
      typeof query.code !== "string" ||
      typeof query.state !== "string" ||
      !safeEqual(query.state, tx.state)
    ) {
      return this.fail(res, sso.appBaseUrl, tx?.returnTo, "invalid_state");
    }

    try {
      const idToken = await this.oidc.exchangeCode(query.code, tx.verifier);
      const identity = await this.validator.validateIdToken(idToken, tx.nonce);
      const user = await this.auth.upsertUser(identity);
      const { token, expiresAt } = await this.auth.createSession(user);

      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.cfg, expiresAt));
      return res.redirect(`${sso.appBaseUrl}${tx.returnTo}`);
    } catch (err) {
      if (err instanceof IdTokenValidationError) {
        this.log.warn(`ID token rejected: ${err.reason}`);
        return this.fail(res, sso.appBaseUrl, tx.returnTo, "invalid_token");
      }
      this.log.error("Login failed", err instanceof Error ? err.stack : String(err));
      return this.fail(res, sso.appBaseUrl, tx.returnTo, "login_failed");
    }
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await this.auth.revoke(token);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.cfg));
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  // A student who started on /j/:pin goes back there, where the guest option
  // is offered (MD-5 §6.6). A host goes back to the login page.
  private fail(res: Response, appBaseUrl: string, returnTo: string | undefined, code: string) {
    const join = returnTo ? joinPath(returnTo) : null;
    if (join) return res.redirect(`${appBaseUrl}${join}?sso_error=${code}`);
    return res.redirect(`${appBaseUrl}/login?error=${code}`);
  }
}

/** "/j/123456" when the login started on a join page, else null. */
function joinPath(returnTo: string): string | null {
  return /^\/j\/\d{6}(?=[?#]|$)/.exec(returnTo)?.[0] ?? null;
}
