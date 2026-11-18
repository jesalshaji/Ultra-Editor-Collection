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

// Allow developer (unsigned) panels for every recent CEP version (Premiere / After Effects 2020-2026).
// Current user only (HKCU), no admin needed.
const done = [];
for (const v of [9, 10, 11, 12]) {
  try {
    execFileSync('reg', ['add', String.raw`HKCU\Software\Adobe\CSXS.` + v, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f'], { stdio: 'ignore' });
    done.push('CSXS.' + v);
  } catch {}
}
if (done.length) console.log('developer panels allowed for', done.join(', '));
else console.log('\nCould not set PlayerDebugMode. In a terminal run:\n' +
  String.raw`  reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f`);
console.log('\nNow restart Premiere Pro (and After Effects if you use it), open a project, then Window > Extensions > Ultra Premiere.');
