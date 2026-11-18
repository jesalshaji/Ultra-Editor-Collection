// Quick check that Claude can reach Premiere: node scripts/test-bridge.js
import { health, call } from '../server/bridge-client.js';
if (!(await health())) { console.log('NOT CONNECTED: open Premiere, then Window > Extensions > Ultra Premiere.'); process.exit(1); }
console.log('ping:', await call('ping'));
try { console.log('project:', JSON.stringify(await call('get_project'), null, 1)); } catch (e) { console.log('project:', e.message); }
