import { Module } from "@nestjs/common";
import { createRemoteJWKSet } from "jose";
import { AUTH_CONFIG, AuthConfig, loadAuthConfig } from "./auth.config";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { OidcService } from "./oidc.service";
import { JWKS, TokenValidatorService } from "./token-validator.service";

@Module({
  controllers: [AuthController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: () => loadAuthConfig() },
    {
      provide: JWKS,
      inject: [AUTH_CONFIG],
      useFactory: (cfg: AuthConfig) =>
        cfg.sso
          ? createRemoteJWKSet(new URL(`${cfg.sso.authority}/discovery/v2.0/keys`))
          : () => Promise.reject(new Error("KMUTT SSO is not configured")),
    },
    TokenValidatorService,
    OidcService,
    AuthService,
    AuthGuard,
  ],
  // AuthGuard's dependencies must resolve in any module that uses @UseGuards(AuthGuard).
  exports: [AuthService, AuthGuard, AUTH_CONFIG],
})
export class AuthModule {}
