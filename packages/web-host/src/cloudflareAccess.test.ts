import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createCloudflareAccessVerifier,
  extractCloudflareAccessToken,
  normalizeCloudflareTeamDomain,
  resolveCloudflareAccessConfig,
  type CloudflareAccessConfig,
} from './cloudflareAccess.js';

const config: CloudflareAccessConfig = {
  teamDomain: 'https://example.cloudflareaccess.com',
  audience: 'test-audience',
};

describe('cloudflare Access JWT verification', () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let verifier: ReturnType<typeof createCloudflareAccessVerifier>;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = 'test-key';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    const keySet = createLocalJWKSet({ keys: [publicJwk] });
    verifier = createCloudflareAccessVerifier(config, keySet);
  });

  async function signToken(
    claims: Record<string, unknown> = {},
    options: { audience?: string; issuer?: string; expiration?: number | string } = {}
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email: 'user@example.com', type: 'app', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
      .setIssuer(options.issuer ?? config.teamDomain)
      .setAudience(options.audience ?? config.audience)
      .setIssuedAt(now)
      .setExpirationTime(options.expiration ?? now + 300)
      .sign(privateKey);
  }

  it('accepts a valid Cloudflare Access application token', async () => {
    const token = await signToken({ sub: 'cloudflare-subject' });

    await expect(verifier(token)).resolves.toMatchObject({
      email: 'user@example.com',
      subject: 'cloudflare-subject',
    });
  });

  it('accepts a valid Cloudflare Access token with optional email omitted', async () => {
    const token = await signToken({ sub: 'cloudflare-subject', email: undefined });

    await expect(verifier(token)).resolves.toMatchObject({
      subject: 'cloudflare-subject',
    });
  });

  it.each([
    [
      'a tampered signature',
      async () => {
        const token = await signToken({ sub: 'cloudflare-subject' });
        const [header, payload, signature] = token.split('.');
        const tamperedSignature = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
        return `${header}.${payload}.${tamperedSignature}`;
      },
    ],
    ['the wrong audience', () => signToken({ sub: 'cloudflare-subject' }, { audience: 'another-audience' })],
    ['the wrong issuer', () => signToken({ sub: 'cloudflare-subject' }, { issuer: 'https://other.cloudflareaccess.com' })],
    ['an expired token', () => signToken({ sub: 'cloudflare-subject' }, { expiration: Math.floor(Date.now() / 1000) - 1 })],
    ['a token without a subject', () => signToken({ sub: '' })],
  ])('rejects %s', async (_description, createToken) => {
    await expect(verifier(await createToken())).resolves.toBeNull();
  });
});

describe('cloudflare Access configuration and token extraction', () => {
  it('normalizes only HTTPS team domains without a path', () => {
    expect(normalizeCloudflareTeamDomain(' https://team.cloudflareaccess.com/ ')).toBe(
      'https://team.cloudflareaccess.com'
    );
    expect(normalizeCloudflareTeamDomain('http://team.cloudflareaccess.com')).toBeNull();
    expect(normalizeCloudflareTeamDomain('https://team.cloudflareaccess.com/path')).toBeNull();
  });

  it('resolves supported environment variable aliases', () => {
    expect(
      resolveCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
        CLOUDFLARE_ACCESS_AUDIENCE: 'audience-tag',
      })
    ).toEqual({ teamDomain: 'https://team.cloudflareaccess.com', audience: 'audience-tag' });
    expect(
      resolveCloudflareAccessConfig({ AIONUI_CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com' })
    ).toBeNull();
  });

  it('extracts the assertion header before the authorization cookie', () => {
    expect(
      extractCloudflareAccessToken({
        'cf-access-jwt-assertion': 'header-token',
        cookie: 'foo=bar; CF_Authorization=cookie-token',
      })
    ).toBe('header-token');
    expect(extractCloudflareAccessToken({ cookie: 'foo=bar; CF_Authorization=cookie-token' })).toBe('cookie-token');
    expect(extractCloudflareAccessToken({ 'cf-access-authenticated-user-email': 'forged@example.com' })).toBeNull();
  });
});
