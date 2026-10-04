import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker, { type Env } from '../worker/index.ts';
import {
  authConfigured, authenticatedSession, createSessionToken, handleAuthRequest,
  requestSessionToken, SESSION_SECONDS, sessionCookie, sha256, sameOrigin,
  verifyPassword, verifySessionToken, type AuthEnv,
} from '../worker/auth.ts';

const origin = 'https://finance.example.com';
const password = 'random-test-access-key-not-a-production-credential';
const salt = '0123456789abcdef0123456789abcdef';

function database(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0002_auth.sql', import.meta.url), 'utf8'));
  const prepare = (query: string) => {
    let values: unknown[] = [];
    return {
      bind(...bound: unknown[]) { values = bound; return this; },
      async first() { return sqlite.prepare(query).get(...values as never[]) ?? null; },
      async run() { return sqlite.prepare(query).run(...values as never[]); },
    };
  };
  return {
    prepare,
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}

async function environment(): Promise<AuthEnv> {
  return {
    DB: database(),
    AUTH_PASSWORD_HASH: `sha256:${salt}:${await sha256(`${salt}:${password}`)}`,
    SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
  };
}

function request(path: string, options: { method?: string; password?: string; cookie?: string; origin?: string; ip?: string } = {}): Request {
  const headers = new Headers();
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin !== undefined) headers.set('origin', options.origin);
  if (options.ip !== undefined) headers.set('cf-connecting-ip', options.ip);
  if (options.password !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${origin}${path}`, {
    method: options.method ?? 'GET', headers,
    ...(options.password !== undefined ? { body: JSON.stringify({ password: options.password }) } : {}),
  });
}

async function login(env: AuthEnv, value = password, ip = '203.0.113.7'): Promise<Response> {
  return handleAuthRequest(request('/api/auth/login', { method: 'POST', password: value, origin, ip }), env);
}

test('generated access-key hash verifies without accepting incorrect credentials or bad configuration', async () => {
  const env = await environment();
  assert.equal(authConfigured(env), true);
  assert.equal(await verifyPassword(password, env), true);
  assert.equal(await verifyPassword(`${password}!`, env), false);
  assert.equal(await verifyPassword('x'.repeat(1025), env), false);
  assert.equal(authConfigured({ ...env, AUTH_PASSWORD_HASH: 'plaintext' }), false);
  assert.equal(authConfigured({ ...env, SESSION_SECRET: 'short' }), false);
});

test('signed sessions reject tampering, expiry, key rotation, and password rotation', async () => {
  const env = await environment();
  const now = Math.floor(Date.now() / 1000);
  const { token, claims } = await createSessionToken(env, now);
  assert.equal((await verifySessionToken(token, env, now))?.id, claims.id);
  assert.equal(await verifySessionToken(token, env, now + SESSION_SECONDS), null);
  assert.equal(await verifySessionToken(token, env, now - 61), null);
  assert.equal(await verifySessionToken(`x${token}`, env, now), null);
  assert.equal(await verifySessionToken(token, { ...env, SESSION_SECRET: 'b'.repeat(64) }, now), null);
  assert.equal(await verifySessionToken(token, { ...env, AUTH_PASSWORD_HASH: `sha256:${salt}:${'a'.repeat(64)}` }, now), null);
  assert.equal(await verifySessionToken('not.a.valid.token', env, now), null);
});

test('login persists a session and logout revokes the original signed cookie', async () => {
  const env = await environment();
  const response = await login(env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true });
  const setCookie = response.headers.get('set-cookie')!;
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_SECONDS}`]) assert.ok(setCookie.includes(flag));
  const cookie = setCookie.split(';')[0]!;
  const sessionRequest = request('/api/auth/session', { cookie });
  assert.ok(await authenticatedSession(sessionRequest, env));
  assert.deepEqual(await (await handleAuthRequest(sessionRequest, env)).json(), { authenticated: true, configured: true });
  const logout = await handleAuthRequest(request('/api/auth/logout', { method: 'POST', cookie, origin }), env);
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
  assert.equal(await authenticatedSession(sessionRequest, env), null);
});

test('a correctly signed token that has no saved session is rejected', async () => {
  const env = await environment();
  const { token } = await createSessionToken(env);
  assert.equal(await authenticatedSession(request('/api/auth/session', { cookie: `meezaniyah_session=${token}` }), env), null);
});

test('login throttle permits five attempts per IP, blocks correct keys while locked, and recovers after expiry', async () => {
  const env = await environment();
  for (let index = 0; index < 5; index++) assert.equal((await login(env, 'wrong')).status, 401);
  const limited = await login(env);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await login(env, password, '203.0.113.8')).status, 200);
  await env.DB.prepare('UPDATE auth_login_attempts SET expires_at = 0').run();
  assert.equal((await login(env)).status, 200);
});

test('concurrent requests share an atomic throttle, and raw client addresses are not persisted', async () => {
  const env = await environment();
  const responses = await Promise.all(Array.from({ length: 12 }, () => login(env, 'wrong')));
  assert.equal(responses.filter((response) => response.status === 401).length, 5);
  assert.equal(responses.filter((response) => response.status === 429).length, 7);
  const row = await env.DB.prepare('SELECT bucket FROM auth_login_attempts').first<{ bucket: string }>();
  assert.equal(row?.bucket.includes('203.0.113.7'), false);
});

test('login and logout reject absent, null, cross-site, and lookalike origins', async () => {
  const env = await environment();
  for (const invalidOrigin of [undefined, 'null', 'https://finance.example.com.attacker.test', 'https://attacker.test']) {
    const response = await handleAuthRequest(request('/api/auth/login', { method: 'POST', password, origin: invalidOrigin }), env);
    assert.equal(response.status, 403);
  }
  const crossSite = request('/api/auth/logout', { method: 'POST', origin });
  crossSite.headers.set('sec-fetch-site', 'cross-site');
  assert.equal((await handleAuthRequest(crossSite, env)).status, 403);
  assert.equal(sameOrigin(request('/api/auth/login', { origin }), { ...env, APP_ORIGIN: 'https://another.example.com' }), false);
  assert.equal(sameOrigin(request('/api/auth/login', { origin: 'http://localhost:5173' }), { ...env, APP_ORIGIN: 'http://localhost:5173' }), true);
});

test('oversized, malformed, non-JSON, and missing-password bodies fail without creating a session', async () => {
  for (const [body, type] of [
    ['{"password":', 'application/json'],
    [JSON.stringify({ password: 'x'.repeat(5000) }), 'application/json'],
    [JSON.stringify({ password }), 'text/plain'],
    ['{}', 'application/json'],
  ]) {
    const env = await environment();
    const response = await handleAuthRequest(new Request(`${origin}/api/auth/login`, { method: 'POST', body, headers: { origin, 'content-type': type! } }), env);
    assert.equal(response.status, 401);
    assert.equal(await env.DB.prepare('SELECT id FROM auth_sessions').first(), null);
  }
});

test('unconfigured sign-in fails closed and duplicate cookies are refused', async () => {
  const env = await environment();
  assert.deepEqual(await (await handleAuthRequest(request('/api/auth/session'), { ...env, SESSION_SECRET: undefined })).json(), { configured: false, authenticated: false });
  assert.equal((await login({ ...env, SESSION_SECRET: undefined })).status, 503);
  assert.equal(requestSessionToken(request('/', { cookie: 'meezaniyah_session=a; meezaniyah_session=b' })), null);
  assert.equal(sessionCookie(new Request('http://localhost:8787'), 'value').includes('; Secure'), false);
});

test('auth endpoints reject unsupported methods', async () => {
  const env = await environment();
  assert.equal((await handleAuthRequest(request('/api/auth/login'), env)).status, 405);
  assert.equal((await handleAuthRequest(request('/api/auth/session', { method: 'POST', origin }), env)).status, 405);
  assert.equal((await handleAuthRequest(request('/api/auth/missing'), env)).status, 404);
});

async function workerEnvironment(): Promise<Env> {
  return {
    ...await environment(),
    ASSETS: { async fetch() { return new Response('<!doctype html><title>Sign in</title>', { headers: { 'content-type': 'text/html' } }); } } as unknown as Fetcher,
  };
}

test('Worker keeps financial routes private while serving the public login shell', async () => {
  const env = await workerEnvironment();
  for (const path of ['/api', '/api/bootstrap', '/api/accounts', '/api/transactions', '/api/budgets', '/api/summary', '/api/unknown']) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
  }
  assert.deepEqual(await (await worker.fetch(request('/api/health'), env)).json(), { ok: true });
  const shell = await worker.fetch(request('/'), env);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('cache-control'), 'no-store');
  assert.ok(shell.headers.get('content-security-policy')?.includes("script-src 'self'"));
  assert.ok(shell.headers.get('strict-transport-security'));
});

test('Worker rejects cross-origin financial writes even with a valid session', async () => {
  const env = await workerEnvironment();
  const response = await login(env);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const crossSite = await worker.fetch(request('/api/sync', { method: 'POST', cookie, origin: 'https://attacker.test' }), env);
  assert.equal(crossSite.status, 403);
  const unknown = await worker.fetch(request('/api/unknown', { cookie }), env);
  assert.equal(unknown.status, 404);
});

test('Worker blocks secret and source paths and hides exception details', async () => {
  const env = await workerEnvironment();
  for (const path of ['/secret.json', '/%73ecret.json', '/.dev.vars', '/.env', '/.git/config', '/.local/login.txt', '/worker/auth.ts', '/migrations/0002_auth.sql', '/package.json']) {
    assert.equal((await worker.fetch(request(path), env)).status, 404, path);
  }
  const failing = { ...env, ASSETS: { async fetch() { throw new Error('https://private-user:private-secret@example.com'); } } } as unknown as Env;
  const error = await worker.fetch(request('/'), failing);
  assert.equal(error.status, 503);
  assert.equal((await error.text()).includes('private-secret'), false);
  assert.equal((await worker.fetch(request('/api/accounts'), { ...env, AUTH_PASSWORD_HASH: undefined })).status, 503);
});

test('Worker upgrades public HTTP requests but permits loopback development', async () => {
  const env = await workerEnvironment();
  const response = await worker.fetch(new Request('http://finance.example.com/'), env);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://finance.example.com/');
  assert.equal((await worker.fetch(new Request('http://127.0.0.1:8787/'), env)).status, 200);
});
