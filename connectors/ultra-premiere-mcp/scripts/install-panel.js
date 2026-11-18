// Installs the Ultra Premiere panel into Premiere for the current Windows user (no admin needed):
// links panel/com.ultrapremiere.bridge into %APPDATA%\Adobe\CEP\extensions, then checks that
// Premiere allows developer (unsigned) panels. Run again any time; restart Premiere afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'panel', 'com.ultrapremiere.bridge');
const EXT = path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions');
const DEST = path.join(EXT, 'com.ultrapremiere.bridge');

fs.mkdirSync(EXT, { recursive: true });
try {
  const st = fs.lstatSync(DEST);
  if (st.isSymbolicLink()) fs.unlinkSync(DEST);
  else { const bak = DEST + '.backup-' + Date.now(); fs.renameSync(DEST, bak); console.log('old copy moved to', bak); }
} catch {}
fs.symlinkSync(SRC, DEST, 'junction');
console.log('panel linked:', DEST, '->', SRC);

let ok = false;
try {
  const out = execFileSync('reg', ['query', String.raw`HKCU\Software\Adobe\CSXS.12`, '/v', 'PlayerDebugMode'], { encoding: 'utf8' });
  ok = /PlayerDebugMode\s+REG_SZ\s+1/.test(out);
} catch {}
if (ok) console.log('developer panels are allowed (CSXS.12 PlayerDebugMode = 1)');
else console.log('\nPremiere will hide the panel until developer panels are allowed. In a terminal run:\n' +
  String.raw`  reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f`);
console.log('\nNow restart Premiere Pro, open a project, then Window > Extensions > Ultra Premiere.');
