// Talks to the Ultra Premiere bridge panel running inside Premiere (127.0.0.1:47231).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = path.join(os.homedir(), '.ultra-premiere-mcp');
const TOKEN_FILE = path.join(HOME, 'token');
const PORT = Number(process.env.ULTRA_PREMIERE_PORT || 47231);

function token() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return ''; }
}

const NOT_RUNNING =
  'Premiere is not connected. Open Adobe Premiere Pro (with a project), then open ' +
  'Window > Extensions > Ultra Premiere and check it says "Connected".';

const AE_PORT = Number(process.env.ULTRA_AE_PORT || 47232);
const AE_NOT_RUNNING =
  'After Effects is not connected. Open After Effects, then Window > Extensions > Ultra Premiere (the panel title reads "Ultra AE Link") and check it says ' +
  '"Connected" (first time: run "node scripts/install-panel.js" and restart After Effects).';

export function health(port = PORT) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** Run a command in Premiere. Returns the result or throws an Error with Premiere's message. */
export function call(cmd, args = {}, timeoutMs = 120000) { return send(PORT, 'Premiere', NOT_RUNNING, cmd, args, timeoutMs); }
/** Run a command in After Effects (same bridge, its own port). */
export function callAE(cmd, args = {}, timeoutMs = 120000) { return send(AE_PORT, 'After Effects', AE_NOT_RUNNING, cmd, args, timeoutMs); }
export const aeHealth = () => health(AE_PORT);

function send(port, app, notRunning, cmd, args, timeoutMs) {
  const body = JSON.stringify({ cmd, args, timeoutMs });
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/run', method: 'POST', timeout: timeoutMs + 5000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-bridge-token': token() } },
      (res) => {
        let d = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Error('Bridge refused the token. Restart ' + app + ' so both sides share ~/.ultra-premiere-mcp/token.'));
          let msg;
          try { msg = JSON.parse(d); } catch { return reject(new Error('Bad reply from ' + app + ': ' + d.slice(0, 300))); }
          if (msg.ok) resolve(msg.result); else reject(new Error(msg.error || app + ' command failed'));
        });
      }
    );
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? notRunning : e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('No answer from ' + app + ' in time.')); });
    req.end(body);
  });
}
