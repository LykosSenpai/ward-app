import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const clientPkg = JSON.parse(readFileSync(resolve(root, 'apps/client/package.json'), 'utf8'));
const appSource = readFileSync(resolve(root, 'apps/client/src/App.tsx'), 'utf8');

const rootScripts = rootPkg.scripts ?? {};
const clientScripts = clientPkg.scripts ?? {};

const checks = [];
const pass = (label, detail = '') => checks.push({ level: 'PASS', label, detail });
const warn = (label, detail = '') => checks.push({ level: 'WARN', label, detail });

const has = (obj, key) => typeof obj[key] === 'string' && obj[key].trim().length > 0;

const requiredClientChecks = [
  'check:board-preview-integration',
  'check:phase4-qa',
  'check:board-3d-gameplay-smoke',
  'check:board-3d-battle-smoke',
  'check:board-3d-multiplayer-smoke',
  'check:board-3d-target-prompt-smoke',
  'check:board-render-adapter',
  'check:board-3d-only-regression',
  'check:embed'
];

for (const key of requiredClientChecks) {
  has(clientScripts, key)
    ? pass(`Automation script exists: ${key}`)
    : warn(`Missing automation script: ${key}`);
}

existsSync(resolve(root, 'tools/board3d-readiness-report.mjs'))
  ? pass('Readiness reporter exists: tools/board3d-readiness-report.mjs')
  : warn('Missing readiness reporter: tools/board3d-readiness-report.mjs');

const requiredDocs = [
  'docs/3d-board-migration-plan.md',
  'docs/3d-board-migration-status.md',
  'docs/3d-board-integration-review.md',
  'docs/phase4-qa-signoff.md'
];

for (const docPath of requiredDocs) {
  existsSync(resolve(root, docPath))
    ? pass(`Documentation exists: ${docPath}`)
    : warn(`Missing documentation: ${docPath}`);
}

if (/from\s+["']\.\/components\/CardBoardView["']/.test(appSource) || /<CardBoardView\b/.test(appSource)) {
  warn('Legacy 2D live board usage still appears in App.tsx');
} else {
  pass('App.tsx does not import/render legacy CardBoardView');
}

existsSync(resolve(root, 'apps/client/src/components/CardBoardView.tsx'))
  ? warn('Legacy 2D component still exists: apps/client/src/components/CardBoardView.tsx')
  : pass('Legacy 2D component removed: apps/client/src/components/CardBoardView.tsx');

existsSync(resolve(root, 'apps/client/src/styles/app-06-interactive-board.css'))
  ? warn('Legacy 2D stylesheet still exists: apps/client/src/styles/app-06-interactive-board.css')
  : pass('Legacy 2D stylesheet removed: apps/client/src/styles/app-06-interactive-board.css');

const board3dOnlyInApp = /const \[playViewMode, setPlayViewMode\] = useState<PlayViewMode>\("board3d"\)/.test(appSource);
board3dOnlyInApp
  ? pass('App.tsx defaults to board3d play view mode')
  : warn('App.tsx does not clearly default play view mode to board3d');

const statusPath = resolve(root, 'docs/3d-board-migration-status.md');
if (existsSync(statusPath)) {
  const status = readFileSync(statusPath, 'utf8').toLowerCase();
  const hasLiveOnlyMarker =
    status.includes('live multiplayer') &&
    (status.includes('live-only') || status.includes('live sessions') || status.includes('operational'));
  if (hasLiveOnlyMarker) {
    pass('Migration status keeps multiplayer seat/spectator verification as live/operational signoff');
  } else {
    warn('Migration status does not clearly mark multiplayer seat/spectator verification as live-only operational signoff');
  }
}

has(rootScripts, 'check:board-3d')
  ? pass('Root aggregation script exists: check:board-3d')
  : warn('Missing root aggregation script: check:board-3d');

has(rootScripts, 'check:board-3d-readiness')
  ? pass('Root readiness script exists: check:board-3d-readiness')
  : warn('Missing root readiness script: check:board-3d-readiness');

has(rootScripts, 'check:release') && String(rootScripts['check:release']).includes('check:board-3d')
  ? pass('Release gate includes 3D board checks')
  : warn('Release gate does not include 3D board checks');

console.log('=== WARD 3D Board Non-Live Readiness Report ===');
for (const c of checks) {
  console.log(`[${c.level}] ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log('');
console.log('[WARN] Live two-client seat/spectator verification cannot be proven by repository automation — Run live operational match signoff separately.');

const passCount = checks.filter(c => c.level === 'PASS').length;
const warnCount = checks.filter(c => c.level === 'WARN').length + 1;
console.log(`Summary: ${passCount} PASS, ${warnCount} WARN`);
