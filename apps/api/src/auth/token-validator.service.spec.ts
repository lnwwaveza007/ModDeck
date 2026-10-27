import { SignJWT, UnsecuredJWT, generateKeyPair } from 'jose';
import { loadAuthConfig } from './auth.config';
import {
  IdTokenValidationError,
  TokenValidatorService,
} from './token-validator.service';

const TENANT = '79845616-9df0-43e0-8842-e300feb2642a';
const CLIENT = 'f9a6b49a-0163-4d7f-9f9b-76fc04d52c39';
const NONCE = 'nonce-123';

const cfg = loadAuthConfig({
  ENTRA_TENANT_ID: TENANT,
  ENTRA_CLIENT_ID: CLIENT,
  APP_BASE_URL: 'https://app.test',
});

type Keys = Awaited<ReturnType<typeof generateKeyPair>>;
let trusted: Keys;
let attacker: Keys;

beforeAll(async () => {
  trusted = await generateKeyPair('RS256');
  attacker = await generateKeyPair('RS256');
});

interface SignOpts {
  key?: Keys['privateKey'];
  iss?: string;
  aud?: string;
  exp?: string | number;
}

function sign(claims: Record<string, unknown> = {}, opts: SignOpts = {}) {
  return new SignJWT({
    oid: 'oid-1',
    tid: TENANT,
    nonce: NONCE,
    name: 'Somchai Jaidee',
    email: 'Somchai@KMUTT.ac.th',
    ver: '2.0',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? cfg.issuer)
    .setAudience(opts.aud ?? CLIENT)
    .setSubject('pairwise-sub')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? trusted.privateKey);
}

const validator = () =>
  new TokenValidatorService(cfg, async () => trusted.publicKey);

describe('TokenValidatorService', () => {
  it('accepts a valid token and maps claims to an identity', async () => {
    const identity = await validator().validateIdToken(await sign(), NONCE);
    expect(identity).toEqual({
      subject: 'oid-1',
      email: 'somchai@kmutt.ac.th',
      displayName: 'Somchai Jaidee',
      studentId: null,
    });
  });

  it('reads the student/staff ID from the configured claim', async () => {
    const token = await sign({ employeeid: ' 64070001 ' });
    const identity = await validator().validateIdToken(token, NONCE);
    expect(identity.studentId).toBe('64070001');
  });

  it('falls back to preferred_username when email is absent', async () => {
    const token = await sign({
      email: undefined,
      preferred_username: 'Staff@kmutt.ac.th',
    });
    const identity = await validator().validateIdToken(token, NONCE);
    expect(identity.email).toBe('staff@kmutt.ac.th');
  });

  it('falls back to the email when name is absent', async () => {
    const token = await sign({ name: undefined });
    const identity = await validator().validateIdToken(token, NONCE);
    expect(identity.displayName).toBe('somchai@kmutt.ac.th');
  });

  it.each([
    [
      'signature',
      () => sign({}, { key: attacker.privateKey }),
    ],
    [
      'issuer',
      () => sign({}, { iss: 'https://login.microsoftonline.com/other-tenant/v2.0' }),
    ],
    ['audience', () => sign({}, { aud: 'some-other-client' })],
    [
      'expired',
      () => sign({}, { exp: Math.floor(Date.now() / 1000) - 600 }),
    ],
    ['nonce', () => sign({ nonce: 'different' })],
    ['nonce', () => sign({ nonce: undefined })],
    ['tenant', () => sign({ tid: '11111111-1111-1111-1111-111111111111' })],
    ['claims', () => sign({ oid: undefined })],
    ['claims', () => sign({ email: undefined, preferred_username: undefined })],
  ])('rejects with reason "%s"', async (reason, make) => {
    const token = await make();
    await expect(validator().validateIdToken(token, NONCE)).rejects.toMatchObject({
      name: 'IdTokenValidationError',
      reason,
    });
  });

  it('rejects tokens signed with a non-RS256 algorithm', async () => {
    const hs = await new SignJWT({ oid: 'oid-1', tid: TENANT, nonce: NONCE })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(cfg.issuer)
      .setAudience(CLIENT)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('shared-secret-shared-secret-1234'));
    await expect(validator().validateIdToken(hs, NONCE)).rejects.toMatchObject({
      reason: 'signature',
    });
  });

  it('rejects unsigned (alg=none) tokens', async () => {
    const none = new UnsecuredJWT({ oid: 'oid-1', tid: TENANT, nonce: NONCE })
      .setIssuer(cfg.issuer)
      .setAudience(CLIENT)
      .setIssuedAt()
      .setExpirationTime('5m')
      .encode();
    await expect(validator().validateIdToken(none, NONCE)).rejects.toBeInstanceOf(
      IdTokenValidationError,
    );
  });

  it('rejects garbage input as malformed', async () => {
    await expect(
      validator().validateIdToken('not-a-jwt', NONCE),
    ).rejects.toMatchObject({ reason: 'malformed' });
  });
});
