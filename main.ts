// Launch-Odds Radar v11 — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores the board with radar-11 in lib/model.ts, writes the ranked board to
// /output/board.json, the dashboard data beside the page, copies dashboard/
// and screenshots/ to /output, and writes /output/dossier.json with the
// vendored make.fun library.
//
// Anchor: drand quicknet round 34196476, from `makefun init` in this repo
// (root 1958103b65c6bc1fc62c2fdd3435e8b30528d346). The same round is shown in
// the dashboard footer and integrity strip, and carried in data.js.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Anchor round from the init line: makefun anchor 1958103b65c6bc1fc62c2fdd3435e8b30528d346 round 34196476. */
const ANCHOR_ROUND = 34196476;

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot, ANCHOR_ROUND);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

// Pass 2: report the sizes the gate reads, so a re-run can be compared at a glance.
const dashBytes = ['index.html', 'app.css', 'app.js'].reduce((a, f) => a + statSync(join(out, 'dashboard', f)).size, 0);
const dossierBytes = statSync(join(out, 'dossier.json')).size;

const m = radar.metrics;
process.stdout.write(
  `token radar v11: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside, ${radar.set_aside_size} pre-token set aside)\n` +
    `token radar v11: anchor drand quicknet round ${ANCHOR_ROUND}\n` +
    `token radar v11: LOO x${m.loo_geo} (med x${m.loo_med}) WF x${m.wf_geo} (med x${m.wf_med}) folds strat x${m.fold_strat_worst} seq x${m.fold_seq_worst} rand x${m.fold_rand_worst}\n` +
    `token radar v11: coverage P25-P75 ${(m.cov_p25_p75 * 100).toFixed(1)}% P10-P90 ${(m.cov_p10_p90 * 100).toFixed(1)}% AUC ${m.auc} Brier ${m.brier} sigma ${m.sigma_loo}\n` +
    `token radar v11: verdicts FARM ${m.farm} / THIN ${m.thin} / SKIP ${m.skip}\n` +
    `token radar v11: dashboard source ${dashBytes} bytes (cap 65536), dossier ${dossierBytes} bytes (cap 1572864)\n` +
    `token radar v11: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
