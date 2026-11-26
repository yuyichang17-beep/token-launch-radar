// Token Radar — the ranking model.
//
// The board ranks pre-token protocols by the value a launch would imply, and the
// value is built only from the sealed snapshot's own figures. The idea is the one
// an analyst would use on a market that already trades: look at what the market
// pays for the same kind of protocol, then scale it to this protocol's size.
//
//   peer multiple   For each category, the median market-cap-to-TVL ratio of the
//                   protocols in the snapshot that already have a live token.
//                   A category with fewer than three live protocols falls back
//                   to the median over every live protocol. The multiple is
//                   clamped to [0.02, 2.0] so one outlier category cannot run
//                   the board.
//   growth          The protocol's 7-day TVL change, clamped to [-50, +100] per
//                   cent, moves the value by half its size:
//                   1 + clamped_change / 100 * 0.5.
//   maturity        How long the protocol has run with no token, from its
//                   listed_at date against the snapshot's as_of date:
//                   0.7 + min(age_days, 1095) / 1095 * 0.3. A protocol with no
//                   listed date is scored at 365 days. Older, still tokenless
//                   protocols read as closer to a launch, not further from one.
//
//   implied_value_usd = round(tvl_usd * peer_multiple * growth * maturity)
//
// No protocol name is ever special-cased: the same arithmetic scores every row,
// and the peer multiples are computed from the snapshot at run time, not written
// into the code. Two protocols that land on the same dollar figure are separated
// by a deterministic one-dollar step so the board is strictly decreasing by rank.
//
// The board covers the whole watchlist (the floor: at least $50M TVL, no token on
// record, not a wrapped / staked / bridged product of a token that trades) and
// adds every other rankable pre-token protocol below the floor, by TVL. Rankable
// means: no token on record, not a centralised exchange, and not a versioned pool
// (a name ending in a release marker such as "V2"). Live-token protocols are
// never ranked; they are carried separately so the page can show the market's own
// values next to the model's.

/** One protocol entry, exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunables, stated on the dashboard so a reader can argue with them. */
export interface ModelConstants {
  /** Live protocols needed in a category before its own median is trusted. */
  min_peers: number;
  /** Bounds on a peer multiple, so one outlier category cannot run the board. */
  peer_min: number;
  peer_max: number;
  /** How much of the 7-day change reaches the value. */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  /** Maturity curve: floor + range over maturity_days. */
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  /** Age scored when listed_at is missing. */
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  min_peers: 3,
  peer_min: 0.02,
  peer_max: 2.0,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label, shown on the dashboard and in the board rows. */
export const MODEL_VERSION = 'radar-2-peer';

/** The most dollars any implied value may claim (the gate's own ceiling). */
export const IMPLIED_CAP = 100_000_000_000_000;

/** How many live-token protocols the dashboard's comparison table carries. */
export const LIVE_ROWS = 30;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peers_used: number;
    peer_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan is generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peers_used: number;
  peer_source: string;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: the market's own value, shown for comparison, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  /** The protocol's own market-cap-to-TVL ratio, the raw material of the peer table. */
  mcap_tvl_ratio: number | null;
}

/** One category's peer multiple, for the dashboard's comparables table. */
export interface PeerRow {
  category: string;
  peers: number;
  median_ratio: number;
  multiple_used: number;
  source: 'category' | 'overall';
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  overall_peer_multiple: number;
  peers: PeerRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, sorted numerically. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The peer multiples, computed from the snapshot's live-token protocols: for every
 * category with at least `min_peers` live protocols, the median market-cap-to-TVL
 * ratio inside that category; every other category uses the overall median. All
 * multiples are clamped to [peer_min, peer_max].
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, PeerRow>; overall: number } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0);
  const clamp = (v: number): number => Math.min(model.peer_max, Math.max(model.peer_min, v));
  const overall = clamp(median(live.map((p) => p.mcap_usd! / p.tvl_usd)));
  const byCategory = new Map<string, PeerRow>();
  const grouped = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = grouped.get(key);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else grouped.set(key, [p.mcap_usd! / p.tvl_usd]);
  }
  for (const [category, ratios] of [...grouped.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ratios.length >= model.min_peers) {
      const med = median(ratios);
      byCategory.set(category, { category, peers: ratios.length, median_ratio: round4(med), multiple_used: round4(clamp(med)), source: 'category' });
    } else {
      byCategory.set(category, { category, peers: ratios.length, median_ratio: round4(median(ratios)), multiple_used: round4(overall), source: 'overall' });
    }
  }
  return { byCategory, overall };
}

/** The multiple one protocol is scored with, and how many peers stand behind it. */
export function peerFor(p: SnapshotProtocol, peers: { byCategory: Map<string, PeerRow>; overall: number }): { multiple: number; used: number; source: string } {
  const row = peers.byCategory.get(p.category ?? 'Other');
  if (row !== undefined) return { multiple: row.multiple_used, used: row.peers, source: row.source };
  return { multiple: peers.overall, used: 0, source: 'overall' };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  peers: { byCategory: Map<string, PeerRow>; overall: number },
  model: ModelConstants = MODEL,
): { implied: number; peer: { multiple: number; used: number; source: string }; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const peer = peerFor(p, peers);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.min(IMPLIED_CAP, Math.round(p.tvl_usd * peer.multiple * growthMult * maturityMult)));
  return { implied, peer, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, ranks 1..N, implied value strictly decreasing. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug in it is ranked, whatever else follows.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Strictly decreasing implied values: a tie steps down one dollar at a time, so
  // the rank order the model produced is kept and no two rows share a value.
  let prev = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    const implied = Math.min(s.implied, prev - 1);
    prev = implied;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: implied,
      model: {
        peer_multiple: s.peer.multiple,
        peers_used: s.peer.used,
        peer_source: s.peer.source,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open, so the protocol records you as a lender.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through at least one fee cycle.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares; vaults are where these protocols count users.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its own app so the trip is not a bare transfer.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it in the same week.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then settle it rather than leaving the funds idle.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet you farm with.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it; these positions are read from the token balance.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full cover period.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote once in its governance, so the wallet shows up as an active participant.`;
  if (c.includes('payment')) return `Route $${capital} of real payments through ${name} on ${chain} over two weeks, instead of one single test transfer.`;
  if (c.includes('chain')) return `Use $${capital} across ${name}'s own apps on ${chain} — a swap, a deposit and one more transaction — so the wallet looks like a user, not a passer-by.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second, different qualifying action, for a weekly rhythm. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a supply top-up, a borrow and repay, or a collateral switch';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'a swap, a liquidity top-up, or a range adjustment';
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) return 'a vault deposit, a rebalance, or a harvest';
  if (c.includes('bridge') || c.includes('cross chain')) return 'a bridge in either direction, or a swap on the destination chain';
  if (c.includes('staking') || c.includes('restak')) return 'a stake top-up, a restake, or a reward claim';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return 'one small trade, a margin top-up, or a funding-fee settlement';
  if (c.includes('prediction')) return 'one market position, or a settlement of an open one';
  if (c.includes('stable')) return 'a mint, a redeem, or a transfer of the stable asset';
  if (c.includes('rwa')) return 'a mint, a transfer, or a redemption of the yield asset';
  if (c.includes('insurance')) return 'a cover top-up, or a claim check on an open policy';
  if (c.includes('governance')) return 'a vote, a delegation, or a forum comment from the same wallet';
  if (c.includes('payment')) return 'one payment routed through the protocol';
  return 'a deposit, a swap, or a vote';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The
 * plan is derived from the protocol's own record (category, chains, TVL, age),
 * never from a hand-written list of names. Nothing here promises a token or an
 * airdrop: the plan farms the protocol, and the launch, if it ever comes, is the
 * protocol's decision, not this board's.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyActionFor(p);
  const chainNote = p.chains.length > 1 ? ` It also runs on ${p.chains.slice(1, 3).join(' and ')}, but farm on ${chain} first.` : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Never reuse a wallet that holds your main funds.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action each week, such as ${weekly}, so the wallet shows steady use instead of a single burst.${chainNote}`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot window. Withdrawing early is the most common way a farm is wasted.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `If the protocol runs a points program, check its own points page once a week and confirm your position is scored; if it does not, keep farming the product itself.`,
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own rewards page and claim only from the link it publishes. Never pay to claim, and never trust a claim link sent to you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, so you can repeat the position, unwind it, or prove what you did. Then close the position in one orderly exit.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's comparison table. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, carrying its farm plan with it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peers_used: row.model.peers_used,
    peer_source: row.model.peer_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const peers = peerMultiples(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    overall_peer_multiple: round4(peers.overall),
    peers: [...peers.byCategory.values()],
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not sit below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.slug !== r.slug.trim() || r.slug.length === 0 || r.slug.length > 128 || /\s/.test(r.slug)) return `${r.slug}: a bad slug`;
    if (typeof r.name !== 'string' || r.name.trim().length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > IMPLIED_CAP) return `${r.slug} has implied value ${r.implied_value_usd}`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
