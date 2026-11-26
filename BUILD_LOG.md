# Token Radar — build log

Working notes for the make.fun `token-radar-01` entry. Each stage ends with what
was done and what the run proved.

## 2026-11-26 — Stage 1: data pipeline and ranking

- Scaffolded `repo/` from the kit starter's shape: `vendor/makefun-board.ts` copied
  byte-identical (sha256 verified), MIT `LICENSE` copied.
- Wrote `lib/model.ts` by hand (peer-comparable model, not the starter's fixed
  multiple): implied value = TVL × category peer multiple (median live mcap/TVL,
  ≥3 peers else overall median, clamped [0.02, 2.0]) × growth (clamped 7d change,
  weight 0.5) × maturity (age curve, unknown age 365d). Board = whole watchlist
  (40) + every other rankable pre-token protocol below the floor (186). Ties are
  stepped down one dollar so implied value falls strictly by rank. Farm plans:
  7 steps each, derived from category / chains / TVL / age.
- Wrote `main.ts` by hand: reads the sealed snapshot, validates the board against
  the gate's shape, writes `board.json`, `data.js`, copies `dashboard/` and
  `screenshots/`, writes `dossier.json` last via `buildDossier`. Deterministic:
  no clock, no randomness, no network.
- Temporary placeholder PNGs written to `screenshots/` (to be replaced by real
  screenshots in stage 5).
- Verification (Node v24.22.1, `MAKEFUN_OUTPUT_DIR=/tmp/radar-out node main.ts
  --input ../kit/token-radar-01-kit/input/snapshot.json`): 758 protocols, 226 rows
  scored, rank 1 `steakhouse-financial` $494,274,073, rank 226 `valdora-finance`
  $189,738, strictly decreasing, watchlist 40/40 covered, farm steps 20–600 chars
  (min 139, max 294), dossier 67,279 bytes. Median check: overall peer multiple
  0.2138 cross-checked against Python's `statistics.median` on the same live set.

## 2026-11-26 — Stage 2: dashboard board view

- Wrote `dashboard/index.html` (shell, loads `../data.js` then `app.js`) and
  `dashboard/app.css` (dark, plain CSS, no network) by hand.
- Board view renders: lede with the watchlist story, four fact cards, top-5
  spotlight cards, filter controls, sortable paged table (50 rows/page) with
  implied-value bars, watchlist markers, and the model panel.

## 2026-11-26 — Stage 3: detail and filter views

- Wrote `dashboard/app.js` by hand: hash routing so every view opens from a URL —
  `#/board`, `#/board?category=…&chain=…&q=…&minTvl=…&sort=…&page=…`,
  `#/detail/<slug>`, `#/live`, `#/method`. Detail view shows the model breakdown
  (TVL, peer multiple with peer count, growth and maturity multipliers), the
  7-step farm plan with a safety warning, and neighbours on the board. Live view
  shows the market's own values with mcap/TVL ratios. Method view states the
  formula and lists every category's peer multiple.
- Re-ran the pipeline after stages 2–3: same board figures, dashboard copied as
  3 files, dossier still valid.

## 2026-11-26 — Stage 4: README, owner file, determinism check

- Wrote `README.md` (3 make.fun badges, run instructions, model statement,
  referral code placeholder `REFERRAL_CODE_TO_FILL` — account not registered yet),
  `.makefun/owner.json` (wallet `BaSYgKBBNoAZFcW4cqcGVymDQK6EHnB6mpXyNc5E9uCU`),
  `package.json` (`type: module`, silences the module-type warning).
- Second-pass edits: `main.ts` now refuses a dashboard file that names a network
  address (gate self-check); `model.ts` rounds the overall peer multiple to 4
  decimals for display.
- Determinism check: two runs to separate output dirs, byte-compared (see below).
- Dossier rebuild check: `buildDossier` re-run independently on the output dir
  reproduces `dossier.json` byte for byte.

## 2026-11-26 — Stage 5: screenshots + §6 gate self-check

- Screenshot blocker found and fixed: direct `/opt/meta-chromium/chrome` refuses
  to start ("Hatch WebGL domain policy is required") and plain `--screenshot`
  writes nothing visible. Working path: `/opt/hatch/bin/hatch-chromium-sandbox`
  as the launcher + CDP over `--remote-debugging-pipe`, driven by a throwaway
  Node script (`/tmp/cdp-shot.mjs`, stdlib only: Target.createTarget, attach,
  Page.captureScreenshot, base64 back over the pipe). The sandboxed Chrome can
  only see the `--user-data-dir` path, so the output dir was copied there for
  the shots. No file writes inside the sandbox are relied on.
- Fixed a layout bug the first board shot exposed (spotlight card value/meta
  spans ran together) in `app.css`, and a grammar nit ("1 peers") in `app.js`.
- Real screenshots installed in `screenshots/`, placeholders deleted:
  `1-board.png` 1280x900 (144,149 B), `2-detail.png` 1280x1200 (201,994 B,
  `#/detail/steakhouse-financial`), `3-filtered.png` 1280x900 (139,494 B,
  `#/board?category=Lending`). All PNG, long edge ≤1440, short edge ≥800,
  ≤512 KiB.
- Final verification: two fresh runs byte-identical; dossier rebuild
  byte-identical (693,393 bytes); full §6 gate self-check all green (see report).

## Build report

- **What was built**: Token Radar, a pre-token launch radar. Peer-comparable
  implied value (category median live mcap/TVL × TVL × growth × maturity),
  226-row board (whole 40-protocol watchlist + 186 early rows), 7-step farm plan
  per row, static offline dashboard with hash-routed board / detail / filter /
  live / method views.
- **Files**: `main.ts`, `lib/model.ts`, `dashboard/index.html`, `dashboard/app.js`,
  `dashboard/app.css`, `screenshots/1-board.png`, `screenshots/2-detail.png`,
  `screenshots/3-filtered.png`, `vendor/makefun-board.ts` (kit-verbatim),
  `LICENSE` (MIT), `README.md`, `package.json`, `.makefun/owner.json`,
  `BUILD_LOG.md` (this file).
- **board.json**: 226 rows. Rank 1 `steakhouse-financial` $494,274,073;
  rank 226 `valdora-finance` $189,738; strictly decreasing; watchlist 40/40.
- **Two-run consistency**: two runs to separate dirs, `diff -r` clean —
  byte-identical. Dossier rebuild byte-identical.
- **Screenshots**: 1-board (board), 2-detail (Steakhouse Financial detail),
  3-filtered (category=Lending), all within size/dimension caps.
- **Gate self-check (§6)**: dashboard 3 files / 44,256 bytes, no network
  addresses; board 226 rows, all slugs in snapshot, ranks 1..226, implied
  strictly decreasing, farm steps 3–12 × 20–600 chars; screenshots 3/3 within
  caps; dossier `makefun/dossier/v1`, 693,393 bytes ≤1.5 MiB, rebuild matches.
- **Not done / risks**:
  - Referral code is the placeholder `REFERRAL_CODE_TO_FILL` — the make.fun
    account is not registered yet; the coordinator fills it in before submit.
  - No registration, login, submission or payment was done (out of scope for
    this build task); no GitHub repo created or pushed here.
  - The `check` pre-flight (`node cli/makefun.mjs check`) and transcript bundle
    are the coordinator's steps, not this build's.
  - Screenshot method is environment-specific (sandboxed Chromium + CDP pipe);
    the script used lives at `/tmp/cdp-shot.mjs` (scratch, not in the repo).
  - Dashboard data (`data.js`) is generated at run time and is not committed;
    the repo's dashboard renders once `main.ts` has run.

