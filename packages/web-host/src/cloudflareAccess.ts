import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose/jwt/verify';
import type { JWTPayload } from 'jose';

export type CloudflareAccessConfig = {
  teamDomain: string;
  audience: string;
};

export type CloudflareAccessIdentity = {
  email?: string;
  subject: string;
  payload: JWTPayload;
};

export type CloudflareAccessHeaders = Record<string, string | string[] | undefined>;
export type CloudflareAccessVerifier = (token: string) => Promise<CloudflareAccessIdentity | null>;

type CloudflareAccessClaims = JWTPayload & {
  email?: unknown;
  type?: unknown;
};

const TEAM_DOMAIN_ENV_NAMES = [
  'AIONUI_CF_ACCESS_TEAM_DOMAIN',
  'CLOUDFLARE_ACCESS_TEAM_DOMAIN',
  'CF_ACCESS_TEAM_DOMAIN',
  'TEAM_DOMAIN',
] as const;
const AUDIENCE_ENV_NAMES = [
  'AIONUI_CF_ACCESS_AUDIENCE',
  'CLOUDFLARE_ACCESS_AUDIENCE',
  'CF_ACCESS_AUDIENCE',
  'POLICY_AUD',
] as const;
const CLOUDFLARE_ACCESS_JWKS_TIMEOUT_MS = 5000;

function firstNonEmptyEnvValue(env: NodeJS.ProcessEnv, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Normalize a Cloudflare Access team domain into the issuer origin. */
export function normalizeCloudflareTeamDomain(rawDomain: string): string | null {
  try {
    const url = new URL(rawDomain.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Resolve the Cloudflare Access issuer and audience from the process environment. */
export function resolveCloudflareAccessConfig(env: NodeJS.ProcessEnv = process.env): CloudflareAccessConfig | null {
  const rawTeamDomain = firstNonEmptyEnvValue(env, TEAM_DOMAIN_ENV_NAMES);
  const audience = firstNonEmptyEnvValue(env, AUDIENCE_ENV_NAMES);
  if (!rawTeamDomain || !audience) return null;

  const teamDomain = normalizeCloudflareTeamDomain(rawTeamDomain);
  return teamDomain ? { teamDomain, audience } : null;
}

/** Create a verifier that checks Cloudflare Access JWT signatures and claims. */
export function createCloudflareAccessVerifier(
  config: CloudflareAccessConfig,
  keySet?: JWTVerifyGetKey
): CloudflareAccessVerifier {
  const teamDomain = normalizeCloudflareTeamDomain(config.teamDomain);
  const audience = config.audience.trim();
  if (!teamDomain || !audience) {
    throw new Error('Cloudflare Access team domain and audience must be configured');
  }

  const jwks =
    keySet ??
    createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`), {
      timeoutDuration: CLOUDFLARE_ACCESS_JWKS_TIMEOUT_MS,
    });

  return async (token: string): Promise<CloudflareAccessIdentity | null> => {
    if (!token.trim()) return null;

    try {
      const { payload } = await jwtVerify<CloudflareAccessClaims>(token, jwks, {
        algorithms: ['RS256'],
        issuer: teamDomain,
        audience,
        requiredClaims: ['sub', 'exp'],
      });

      if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
        return null;
      }

      const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : undefined;

      return {
        email,
        subject: payload.sub.trim(),
        payload,
      };
    } catch {
      // Do not log raw token or verification internals
      return null;
    }
  };
}

function getHeaderValue(headers: CloudflareAccessHeaders, name: string): string | null {
  const value = headers[name];
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return typeof value === 'string' ? value.trim() || null : null;
}

/** Extract a Cloudflare Access JWT from the assertion header or authorization cookie. */
export function extractCloudflareAccessToken(headers: CloudflareAccessHeaders): string | null {
  const headerToken = getHeaderValue(headers, 'cf-access-jwt-assertion');
  if (headerToken) return headerToken;

  const cookie = getHeaderValue(headers, 'cookie');
  const match = cookie?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match?.[1] ?? null;
}

const verifierCache = new Map<string, CloudflareAccessVerifier>();

/** Verify the Cloudflare Access token on a request and return its trusted identity. */
export async function getCloudflareAccessIdentity(
  headers: CloudflareAccessHeaders,
  env: NodeJS.ProcessEnv = process.env
): Promise<CloudflareAccessIdentity | null> {
  const token = extractCloudflareAccessToken(headers);
  const config = resolveCloudflareAccessConfig(env);
  if (!token || !config) return null;

  const cacheKey = `${config.teamDomain}\n${config.audience}`;
  let verifier = verifierCache.get(cacheKey);
  if (!verifier) {
    verifier = createCloudflareAccessVerifier(config);
    verifierCache.set(cacheKey, verifier);
  }
  return verifier(token);
}
