import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  PARTICIPANT_COOKIE,
  PIN_PATTERN,
  joinBodySchema,
  type JoinBody,
  type JoinResult,
  type ParticipantMe,
  type PinInfo,
} from "@moddeck/shared";
import { API_PREFIX, AUTH_CONFIG, type AuthConfig } from "../auth/auth.config";
import { AuthService } from "../auth/auth.service";
import type { AuthUser } from "../auth/auth.types";
import { SESSION_COOKIE, parseCookies, sessionCookieOptions } from "../auth/cookies";
import { randomToken } from "../auth/crypto.util";
import { ApiException, ZodBody } from "../common/api-error";
import { PinLimiterService } from "./pin-limiter.service";
import { ParticipantsService } from "./participants.service";

// Anonymous id of this browser for the wrong-PIN limit (MD-5 §6.4). It is not
// a login: it only says "the same phone tried again".
export const DEVICE_COOKIE = "moddeck_dev";
const DEVICE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

@Controller()
export class ParticipantsController {
  constructor(
    private readonly participants: ParticipantsService,
    private readonly limiter: PinLimiterService,
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
  ) {}

  @Get("pins/:pin")
  pinInfo(
    @Param("pin") pin: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PinInfo> {
    const cookies = parseCookies(req.headers.cookie);
    return this.withPinLimit(pin, req, res, () =>
      this.participants.pinInfo(pin, cookies[PARTICIPANT_COOKIE]),
    );
  }

  @Post("pins/:pin/participants")
  async join(
    @Param("pin") pin: string,
    @Body(new ZodBody(joinBodySchema)) body: JoinBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<JoinResult> {
    const cookies = parseCookies(req.headers.cookie);
    const nickname = body?.nickname;
    const user = nickname === undefined ? await this.hostUser(cookies, res) : null;
    const outcome = await this.withPinLimit(pin, req, res, () =>
      this.participants.join(pin, nickname, user, cookies[PARTICIPANT_COOKIE]),
    );

    res.cookie(
      PARTICIPANT_COOKIE,
      outcome.token,
      sessionCookieOptions(this.cfg, outcome.expiresAt),
    );
    const { sessionId, participantId } = outcome.result;
    res.status(outcome.created ? 201 : 200);
    if (outcome.created) {
      res.location(`/${API_PREFIX}/sessions/${sessionId}/participants/${participantId}`);
    }
    return outcome.result;
  }

  @Get("participants/me")
  me(@Req() req: Request): Promise<ParticipantMe> {
    return this.participants.me(parseCookies(req.headers.cookie)[PARTICIPANT_COOKIE]);
  }

  /** The KMUTT login of this browser, if any. A student who logs in gets one too. */
  private async hostUser(cookies: Record<string, string>, res: Response): Promise<AuthUser | null> {
    const token = cookies[SESSION_COOKIE];
    if (!token) return null;
    const result = await this.auth.authenticate(token);
    if (!result) return null;
    if (result.renewedExpiresAt) {
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.cfg, result.renewedExpiresAt));
    }
    return result.user;
  }

  // Runs a PIN lookup under the wrong-PIN limit: 429 while over it, and every
  // unknown PIN counts as a miss.
  private async withPinLimit<T>(
    pin: string,
    req: Request,
    res: Response,
    run: () => Promise<T>,
  ): Promise<T> {
    const device = this.device(req, res);
    const ip = req.ip ?? "unknown";
    const wait = await this.limiter.retryAfter(device, ip);
    if (wait !== null) {
      res.setHeader("Retry-After", String(wait));
      throw new ApiException(429, "TOO_MANY_ATTEMPTS", "Too many wrong PINs", {
        retryAfter: wait,
      });
    }
    try {
      if (!PIN_PATTERN.test(pin)) throw new ApiException(404, "NOT_FOUND", "No session found");
      return await run();
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) {
        await this.limiter.recordMiss(device, ip);
      }
      throw error;
    }
  }

  private device(req: Request, res: Response): string {
    const existing = parseCookies(req.headers.cookie)[DEVICE_COOKIE];
    if (existing && /^[\w-]{16,64}$/.test(existing)) return existing;
    const fresh = randomToken(16);
    res.cookie(DEVICE_COOKIE, fresh, {
      ...sessionCookieOptions(this.cfg),
      maxAge: DEVICE_MAX_AGE_MS,
    });
    return fresh;
  }
}
