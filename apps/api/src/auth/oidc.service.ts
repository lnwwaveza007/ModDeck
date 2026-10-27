import { Inject, Injectable } from '@nestjs/common';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { randomToken, sha256Base64Url } from './crypto.util';

export interface LoginTx {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

export const DEFAULT_RETURN_TO = '/decks';

/** Only same-site relative paths are allowed (prevents open redirects). */
export function sanitizeReturnTo(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    /[\r\n]/.test(raw)
  ) {
    return DEFAULT_RETURN_TO;
  }
  return raw;
}

export const encodeTx = (tx: LoginTx): string =>
  Buffer.from(JSON.stringify(tx)).toString('base64url');

export function decodeTx(raw: string | undefined): LoginTx | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof v?.state === 'string' &&
      typeof v?.nonce === 'string' &&
      typeof v?.verifier === 'string'
    ) {
      return {
        state: v.state,
        nonce: v.nonce,
        verifier: v.verifier,
        returnTo: sanitizeReturnTo(v.returnTo),
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

@Injectable()
export class OidcService {
  constructor(@Inject(AUTH_CONFIG) private readonly cfg: AuthConfig) {}

  /** Builds the authorize URL (Authorization Code + PKCE S256) and the transaction to remember. */
  start(returnTo: string): { url: string; tx: LoginTx } {
    const tx: LoginTx = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(32), // 43 chars, within the 43-128 PKCE range
      returnTo,
    };
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: 'code',
      redirect_uri: this.cfg.redirectUri,
      response_mode: 'query',
      scope: 'openid profile email',
      state: tx.state,
      nonce: tx.nonce,
      code_challenge: sha256Base64Url(tx.verifier),
      code_challenge_method: 'S256',
    });
    return {
      url: `${this.cfg.authority}/oauth2/v2.0/authorize?${params}`,
      tx,
    };
  }

  /** Redeems the authorization code and returns the raw ID token. */
  async exchangeCode(code: string, verifier: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
      code_verifier: verifier,
      scope: 'openid profile email',
    });
    if (this.cfg.clientSecret) body.set('client_secret', this.cfg.clientSecret);

    const res = await fetch(`${this.cfg.authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id_token?: string;
      error?: string;
      error_codes?: number[];
    };
    if (!res.ok || typeof json.id_token !== 'string') {
      throw new Error(
        `Token endpoint failed (${res.status} ${json.error ?? 'unknown'} ${json.error_codes?.join(',') ?? ''})`,
      );
    }
    return json.id_token;
  }
}
