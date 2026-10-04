import { authConfigured, authenticatedSession, handleAuthRequest, jsonResponse, sameOrigin, type AuthEnv } from './auth.ts';
import { handleFinanceRequest, type Env as FinanceEnv } from './finance.ts';

export interface Env extends AuthEnv, FinanceEnv {
  ASSETS: Fetcher;
}

function protectedHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '));
  headers.set('x-frame-options', 'DENY');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('cross-origin-resource-policy', 'same-origin');
  if (new URL(request.url).protocol === 'https:') headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  if (new URL(request.url).pathname.startsWith('/api/') || headers.get('content-type')?.includes('text/html')) {
    headers.set('cache-control', 'no-store');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function sensitivePath(path: string): boolean {
  try {
    const decoded = decodeURIComponent(path).toLowerCase();
    const segments = decoded.split('/');
    return segments.some((segment) => segment.startsWith('.') || /^(?:secrets?\.json|wrangler\.(?:toml|jsonc?)|package(?:-lock)?\.json)$/.test(segment))
      || /^\/(?:worker|migrations|tests|node_modules)\//.test(decoded)
      || /\.(?:sqlite3?|db|sql|pem|key|env|map)$/.test(decoded);
  } catch {
    return true;
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.protocol = 'https:';
    return new Response(null, { status: 308, headers: { location: url.toString() } });
  }
  const path = url.pathname;
  if (sensitivePath(path)) return jsonResponse({ error: 'Not found.' }, 404);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request, env)) {
    return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  }
  if (path === '/api/health') {
    return request.method === 'GET' ? jsonResponse({ ok: true }) : jsonResponse({ error: 'Method not allowed.' }, 405, { allow: 'GET' });
  }
  if (path.startsWith('/api/auth/')) return handleAuthRequest(request, env);
  if (path === '/api' || path.startsWith('/api/')) {
    if (!authConfigured(env)) return jsonResponse({ error: 'Sign-in is not configured.' }, 503);
    if (!await authenticatedSession(request, env)) return jsonResponse({ error: 'Sign in to continue.' }, 401);
    return handleFinanceRequest(request, env);
  }
  if (!['GET', 'HEAD'].includes(request.method)) return jsonResponse({ error: 'Method not allowed.' }, 405, { allow: 'GET, HEAD' });
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return protectedHeaders(request, await route(request, env));
    } catch {
      // Never serialize exceptions: upstream URLs can contain SimpleFIN credentials.
      return protectedHeaders(request, jsonResponse({ error: 'The service is temporarily unavailable. Please try again.' }, 503));
    }
  },
} satisfies ExportedHandler<Env>;
