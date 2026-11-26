# Token Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yuyichang17-beep/token-launch-radar/rank.svg)](https://make.fun/competitions/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yuyichang17-beep/token-launch-radar/reward.svg)](https://make.fun/competitions/token-radar-01)

A radar for token launches that have not happened yet. It reads a sealed snapshot
of every protocol DefiLlama tracks, finds the ones that still record no token and
are not a wrapped or staked product of a token that already trades, ranks them by
what their launch would be worth, and hands you a dashboard — the board, a detail
view for every protocol, and the steps to farm each one.

Built for the [make.fun](https://make.fun) competition
**Build the best token launch radar** (`token-radar-01`).

## How the ranking works

No protocol name is special-cased; one function scores every row, from the
snapshot's own figures:

```
implied = round( TVL × peer multiple × growth × maturity )
```

- **Peer multiple** — the median market-cap-to-TVL ratio of the live-token
  protocols in the same category (at least 3 peers, otherwise the overall median),
  clamped to [0.02, 2.0]. The market prices a protocol's own kind; the radar
  scales that price to this protocol's size.
- **Growth** — `1 + clamp(7-day TVL change, −50%, +100%) / 100 × 0.5`.
- **Maturity** — `0.7 + min(age in days, 1095) / 1095 × 0.3`, where age is the time
  since the protocol was first listed; an unlisted age is scored at 365 days.
  A protocol that has run longer with no token reads as closer to a launch.

The board covers the whole watchlist (40 protocols: at least $50M TVL, no token
on record, not a wrapped / staked / bridged product) and adds every other
rankable pre-token protocol below the floor — 226 rows in this snapshot.
Live-token protocols are never ranked; they are shown apart, with their market
caps, as the comparables the ranking is priced from.

Farm plans are seven steps each, derived from the protocol's own record: its
category decides the core action, its TVL sizes the capital, its age sets the
hold, its chains pick where to farm. Nothing promises a token or an airdrop.

## Run it

Node 22 or later, standard library only — nothing to install.

```sh
# From this repository's root, with the sealed snapshot at ../input/snapshot.json:
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. The program is deterministic: no
clock, no randomness, no network — two runs write the same bytes.

Open `out/dashboard/index.html` in a browser (it loads `out/data.js` from
beside it) or serve the `out/` directory. Views are hash routes, so each one
opens from a plain URL:

- `index.html#/board` — the ranked board
- `index.html#/board?category=Lending` — the board, filtered by category
- `index.html#/board?chain=Solana&q=stake` — search + chain filter
- `index.html#/detail/<slug>` — one protocol's detail view and farm plan
- `index.html#/live` — protocols whose token already trades
- `index.html#/method` — the full method and the peer-multiple table

## Layout

| Path | What it is |
|---|---|
| `main.ts` | The entry program: snapshot in, board / dashboard / dossier out |
| `lib/model.ts` | The ranking model, the peer multiples and the farm plans |
| `dashboard/` | The static page: `index.html`, `app.js`, `app.css` (no network) |
| `screenshots/` | Board, detail and filtered views of the dashboard |
| `vendor/makefun-board.ts` | make.fun's dossier library, copied from the kit |
| `.makefun/owner.json` | The wallet that owns this entry |

## Referral

Referral code: `rbnfmykw` — [join make.fun with this referral link](https://make.fun/r/rbnfmykw).

## License

MIT — see [LICENSE](LICENSE).

<sub>Entered on [make.fun](https://make.fun/?ref=rbnfmykw&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
