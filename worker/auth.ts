/** Authentication for one private household. The password must be randomly generated. */
export interface AuthEnv {
  DB: D1Database;
  AUTH_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  APP_ORIGIN?: string;
}

export const SESSION_COOKIE = 'meezaniyah_session';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 5;

interface PasswordHash {
  salt: string;
  digest: string;
}

export interface SessionClaims {
  v: 1;
  sub: 'household';
  id: string;
  iat: number;
  exp: number;
  passwordVersion: string;
}

function parsePasswordHash(value: string | undefined): PasswordHash | null {
  const match = /^sha256:([a-zA-Z0-9_-]{16,128}):([a-f0-9]{64})$/.exec(value ?? '');
  return match ? { salt: match[1]!, digest: match[2]! } : null;
}

export function authConfigured(env: AuthEnv): boolean {
  return parsePasswordHash(env.AUTH_PASSWORD_HASH) !== null && (env.SESSION_SECRET?.length ?? 0) >= 32;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/** SHA-256 is appropriate here only because the provisioned access key has >=192 random bits. */
export async function verifyPassword(password: string, env: AuthEnv): Promise<boolean> {
  const configuredHash = parsePasswordHash(env.AUTH_PASSWORD_HASH);
  if (!configuredHash || password.length > 1024) return false;
  const actual = await sha256(`${configuredHash.salt}:${password}`);
  let difference = 0;
  for (let index = 0; index < configuredHash.digest.length; index++) {
    difference |= configuredHash.digest.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
}

async function signingKey(env: AuthEnv): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionToken(env: AuthEnv, now = Math.floor(Date.now() / 1000)): Promise<{ token: string; claims: SessionClaims }> {
  if (!authConfigured(env)) throw new Error('Authentication is not configured');
  const claims: SessionClaims = {
    v: 1,
    sub: 'household',
    id: base64url(crypto.getRandomValues(new Uint8Array(24))),
    iat: now,
    exp: now + SESSION_SECONDS,
    // Rotating the provisioned password invalidates sessions as well as future logins.
    passwordVersion: await sha256(`session-password-version:${env.AUTH_PASSWORD_HASH}`),
  };
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(payload));
  return { token: `${payload}.${base64url(new Uint8Array(signature))}`, claims };
}

export async function verifySessionToken(token: string, env: AuthEnv, now = Math.floor(Date.now() / 1000)): Promise<SessionClaims | null> {
  if (!authConfigured(env) || token.length > 2048) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts as [string, string];
    if (!await crypto.subtle.verify('HMAC', await signingKey(env), fromBase64url(signature), encoder.encode(payload))) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as Partial<SessionClaims>;
    if (claims.v !== 1 || claims.sub !== 'household' || typeof claims.id !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(claims.id)) return null;
    if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) return null;
    if (claims.iat! > now + 60 || claims.exp! <= now || claims.exp! - claims.iat! !== SESSION_SECONDS) return null;
    if (claims.passwordVersion !== await sha256(`session-password-version:${env.AUTH_PASSWORD_HASH}`)) return null;
    return claims as SessionClaims;
  } catch {
    return null;
  }
}

export function requestSessionToken(request: Request): string | null {
  const cookies = (request.headers.get('cookie') ?? '').split(';');
  const matches = cookies.map((cookie) => cookie.trim()).filter((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  // Duplicate session cookies can indicate path/domain cookie injection. Fail closed.
  return matches.length === 1 ? matches[0]!.slice(SESSION_COOKIE.length + 1) : null;
}

export function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function sameOrigin(request: Request, env: AuthEnv): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null' || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  try {
    const configured = env.APP_ORIGIN ? new URL(env.APP_ORIGIN) : new URL(request.url);
    return origin === configured.origin;
  } catch {
    return false;
  }
}

export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  responseHeaders.set('cache-control', 'no-store');
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

export async function authenticatedSession(request: Request, env: AuthEnv): Promise<SessionClaims | null> {
  const token = requestSessionToken(request);
  if (!token) return null;
  const claims = await verifySessionToken(token, env);
  if (!claims) return null;
  const saved = await env.DB.prepare('SELECT id FROM auth_sessions WHERE id = ? AND expires_at > ?')
    .bind(claims.id, Math.floor(Date.now() / 1000)).first<{ id: string }>();
  return saved ? claims : null;
}

async function loginBucket(request: Request, env: AuthEnv): Promise<string> {
  // Cloudflare supplies this header; do not trust arbitrary forwarded-IP headers.
  const address = request.headers.get('cf-connecting-ip') ?? 'local-or-unknown';
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(`login:${address}`));
  return base64url(new Uint8Array(signature));
}

async function reserveLoginAttempt(request: Request, env: AuthEnv): Promise<{ bucket: string; allowed: boolean; retryAfter: number }> {
  const bucket = await loginBucket(request, env);
  const now = Math.floor(Date.now() / 1000);
  // The counter is incremented atomically before validation, including concurrent requests.
  const row = await env.DB.prepare(`
    INSERT INTO auth_login_attempts (bucket, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET
      attempts = CASE WHEN auth_login_attempts.expires_at <= ? THEN 1 ELSE auth_login_attempts.attempts + 1 END,
      expires_at = CASE WHEN auth_login_attempts.expires_at <= ? THEN excluded.expires_at ELSE auth_login_attempts.expires_at END
    RETURNING attempts, expires_at
  `).bind(bucket, now + LOGIN_WINDOW_SECONDS, now, now).first<{ attempts: number; expires_at: number }>();
  if (!row) throw new Error('Authentication storage is unavailable');
  return { bucket, allowed: row.attempts <= MAX_LOGIN_ATTEMPTS, retryAfter: Math.max(1, row.expires_at - now) };
}

async function readLoginPassword(request: Request): Promise<string | null> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null;
  if (Number(request.headers.get('content-length')) > 2048 || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 2048) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || !('password' in parsed)) return null;
    return typeof parsed.password === 'string' && parsed.password.length <= 1024 ? parsed.password : null;
  } catch {
    return null;
  }
}

export async function handleAuthRequest(request: Request, env: AuthEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/auth/session') {
    if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed.' }, 405, { allow: 'GET' });
    const configured = authConfigured(env);
    return jsonResponse({ authenticated: configured && !!await authenticatedSession(request, env), configured });
  }
  if (path !== '/api/auth/login' && path !== '/api/auth/logout') return jsonResponse({ error: 'Not found.' }, 404);
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, { allow: 'POST' });
  if (!sameOrigin(request, env)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  if (!authConfigured(env)) return jsonResponse({ error: 'Sign-in is not configured.' }, 503);

  if (path === '/api/auth/logout') {
    const token = requestSessionToken(request);
    const claims = token ? await verifySessionToken(token, env) : null;
    if (claims) await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(claims.id).run();
    return jsonResponse({ authenticated: false }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
  }

  const attempt = await reserveLoginAttempt(request, env);
  if (!attempt.allowed) return jsonResponse({ error: 'Too many sign-in attempts. Try again in 15 minutes.' }, 429, { 'retry-after': String(attempt.retryAfter) });
  const password = await readLoginPassword(request);
  if (password === null || !await verifyPassword(password, env)) return jsonResponse({ error: 'The access key is incorrect.' }, 401);

  const { token, claims } = await createSessionToken(env);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO auth_sessions (id, created_at, expires_at) VALUES (?, ?, ?)').bind(claims.id, claims.iat, claims.exp),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(claims.iat),
    env.DB.prepare('DELETE FROM auth_login_attempts WHERE expires_at <= ? OR bucket = ?').bind(claims.iat, attempt.bucket),
  ]);
  return jsonResponse({ authenticated: true }, 200, { 'set-cookie': sessionCookie(request, token) });
}
