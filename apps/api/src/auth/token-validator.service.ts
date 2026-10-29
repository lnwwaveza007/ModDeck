import { Inject, Injectable } from "@nestjs/common";
import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { AUTH_CONFIG, type AuthConfig, requireSso } from "./auth.config";
import type { EntraIdentity } from "./auth.types";
import { safeEqual } from "./crypto.util";

export const JWKS = Symbol("JWKS");

export type IdTokenFailure =
  "malformed" | "signature" | "issuer" | "audience" | "expired" | "nonce" | "tenant" | "claims";

export class IdTokenValidationError extends Error {
  constructor(
    readonly reason: IdTokenFailure,
    message?: string,
  ) {
    super(message ?? `Invalid ID token: ${reason}`);
    this.name = "IdTokenValidationError";
  }
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

@Injectable()
export class TokenValidatorService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
    @Inject(JWKS) private readonly jwks: JWTVerifyGetKey,
  ) {}

  /**
   * Verifies signature (RS256 via Entra JWKS), issuer, audience, expiry,
   * nonce and tenant, then maps the claims to an identity.
   */
  async validateIdToken(idToken: string, expectedNonce: string): Promise<EntraIdentity> {
    const sso = requireSso(this.cfg);
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: sso.issuer,
        audience: sso.clientId,
        algorithms: ["RS256"],
        clockTolerance: 60,
        requiredClaims: ["exp", "iat"],
      }));
    } catch (err) {
      throw this.translate(err);
    }

    if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, expectedNonce)) {
      throw new IdTokenValidationError("nonce");
    }
    if (
      typeof payload.tid !== "string" ||
      payload.tid.toLowerCase() !== sso.tenantId.toLowerCase()
    ) {
      throw new IdTokenValidationError("tenant");
    }
    return this.toIdentity(payload, sso.studentIdClaim);
  }

  private toIdentity(payload: JWTPayload, studentIdClaim: string): EntraIdentity {
    const subject = str(payload.oid);
    const email = (
      str(payload.email) ??
      str(payload.preferred_username) ??
      str(payload.upn)
    )?.toLowerCase();
    if (!subject || !email) throw new IdTokenValidationError("claims");

    return {
      subject,
      email,
      displayName: str(payload.name) ?? email,
      studentId: str(payload[studentIdClaim]) ?? null,
    };
  }

  private translate(err: unknown): IdTokenValidationError {
    if (err instanceof errors.JWTExpired) {
      return new IdTokenValidationError("expired");
    }
    if (err instanceof errors.JWTClaimValidationFailed) {
      if (err.claim === "iss") return new IdTokenValidationError("issuer");
      if (err.claim === "aud") return new IdTokenValidationError("audience");
      return new IdTokenValidationError("claims");
    }
    if (
      err instanceof errors.JWSSignatureVerificationFailed ||
      err instanceof errors.JWKSNoMatchingKey ||
      err instanceof errors.JWKSMultipleMatchingKeys ||
      err instanceof errors.JOSEAlgNotAllowed
    ) {
      return new IdTokenValidationError("signature");
    }
    return new IdTokenValidationError("malformed");
  }
}
