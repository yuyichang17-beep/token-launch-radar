// Token Radar — the entry program (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, ranks every pre-token protocol with the
// peer-comparable model in lib/model.ts, and writes the entry's outputs:
//
//   /output/board.json     the ranked board (the gate reads this)
//   /output/data.js        the same board, as a script the dashboard loads
//   /output/dashboard/     a copy of this repository's dashboard/
//   /output/screenshots/   a copy of this repository's screenshots/
//   /output/dossier.json   the judge's dossier, built last by the vendored library
//
// Deterministic by construction: the only inputs are the snapshot file and this
// repository's files. No clock, no randomness, no network — two runs write the
// same bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The caps the dossier is built under: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** `--name <value>` out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Fail with a message on stderr and exit code 2, the way a bad invocation should. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(2);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (dash.length === 0) fail('dashboard/ is empty: the page is part of the entry');
for (const name of dash) {
  if (!PLAIN_NAME.test(name)) fail(`dashboard/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}
// The gate refuses a dashboard that names a network address: the page must render offline.
const NETWORK = /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/i;
for (const name of dash) {
  const text = readFileSync(join(out, 'dashboard', name), 'utf8');
  if (NETWORK.test(text)) fail(`dashboard/${name} names a network address: the page must render with no network`);
}

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 or 4, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const bytes = readFileSync(join(here, 'screenshots', name));
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) fail(`screenshots/${name} is neither a PNG nor a JPEG`);
  if (bytes.length > SCREENSHOT_CAPS.max_bytes) fail(`screenshots/${name} is ${bytes.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes} a screenshot may be`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

const top = board[0]!;
const last = board[board.length - 1]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols in the snapshot dated ${snapshot.as_of}, ${snapshot.watchlist.length} on the watchlist\n` +
    `token radar: ${board.length} rows scored (${radar.early_size} early rows below the floor), overall peer multiple ${radar.overall_peer_multiple}\n` +
    `token radar: rank 1 is ${top.slug} at $${top.implied_value_usd.toLocaleString('en-US')}; rank ${last.rank} is ${last.slug} at $${last.implied_value_usd.toLocaleString('en-US')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dash.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
