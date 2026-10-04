import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const local = resolve(root, '.local');
await mkdir(local, { recursive: true, mode: 0o700 });
const secretsPath = resolve(local, 'worker-secrets.json');
let secrets;
try {
  secrets = JSON.parse(await readFile(secretsPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Could not read existing deployment secrets. Nothing was changed.');
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(18).toString('base64url');
  secrets = {
    AUTH_PASSWORD_HASH: `sha256:${salt}:${createHash('sha256').update(`${salt}:${password}`).digest('hex')}`,
    SESSION_SECRET: randomBytes(48).toString('base64url'),
  };
  await writeFile(resolve(local, 'workspace-access.txt'), `Meezaniyah workspace passphrase\n\n${password}\n\nKeep this in your password manager. This file is excluded from version control.\n`, {mode:0o600,flag:'wx'});
}
let source;
try { source = JSON.parse(await readFile(resolve(root, 'secret.json'), 'utf8')); }
catch { throw new Error('Add secret.json containing simplefin_access_url before running setup.'); }
if (typeof source.simplefin_access_url !== 'string') throw new Error('secret.json must contain an already-claimed simplefin_access_url.');
const url = new URL(source.simplefin_access_url);
if (url.protocol !== 'https:' || !(url.hostname === 'simplefin.org' || url.hostname.endsWith('.simplefin.org')) || !url.username || !url.password) {
  throw new Error('SimpleFIN access URL must use HTTPS, a SimpleFIN host, and embedded credentials.');
}
secrets.SIMPLEFIN_ACCESS_URL = source.simplefin_access_url;
await writeFile(secretsPath, JSON.stringify(secrets, null, 2)+'\n', {mode:0o600});
await chmod(secretsPath, 0o600);
const devVars = Object.entries(secrets).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n';
await writeFile(resolve(root, '.dev.vars'), devVars, {mode:0o600});
await chmod(resolve(root, '.dev.vars'), 0o600);
console.log('Local secrets configured. Workspace passphrase saved in .local/workspace-access.txt. No credentials were printed.');
