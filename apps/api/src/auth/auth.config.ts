export const API_PREFIX = 'api';
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export interface AuthConfig {
  tenantId: string;
  clientId: string;
  /** Optional. PKCE-only works when "Allow public client flows" is on. */
  clientSecret?: string;
  appBaseUrl: string;
  redirectUri: string;
  authority: string;
  issuer: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  studentIdClaim: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };

  const tenantId = required('ENTRA_TENANT_ID');
  const clientId = required('ENTRA_CLIENT_ID');
  if (!GUID.test(tenantId)) throw new Error('ENTRA_TENANT_ID must be a GUID');
  if (!GUID.test(clientId)) throw new Error('ENTRA_CLIENT_ID must be a GUID');

  const appBaseUrl = required('APP_BASE_URL').replace(/\/+$/, '');
  const ttlHours = Number(env.SESSION_TTL_HOURS ?? 8);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    throw new Error('SESSION_TTL_HOURS must be a positive number');
  }

  const authority = `https://login.microsoftonline.com/${tenantId}`;
  return {
    tenantId,
    clientId,
    clientSecret: env.ENTRA_CLIENT_SECRET?.trim() || undefined,
    appBaseUrl,
    redirectUri: `${appBaseUrl}/${API_PREFIX}/auth/callback`,
    authority,
    issuer: `${authority}/v2.0`,
    sessionTtlMs: ttlHours * 60 * 60 * 1000,
    cookieSecure: env.AUTH_COOKIE_SECURE !== 'false',
    studentIdClaim: env.ENTRA_STUDENT_ID_CLAIM?.trim() || 'employeeid',
  };
}
