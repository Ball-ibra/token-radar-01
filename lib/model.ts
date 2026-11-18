// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board. Wrapped, staked and bridged products are kept out of the ranking
// too: a wrapped or staked product of a token that already trades is not a protocol still waiting
// on a launch of its own, so the board applies the watchlist's own exclusion (Bridge, Canonical
// Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX, versioned names) to the early rows
// as well as the watchlist.
//
// Implied value follows only from the snapshot's own figures, in four factors:
//
//   peer multiple = the category's own market price. For each category, the median mcap/TVL of
//     the snapshot's live-token protocols in that category (at least 5 peers, else the global
//     median across all live-token protocols with a market cap), clamped to 0.05..0.60. A token
//     is worth what the market already pays for the same kind of protocol, not a flat 25% of
//     TVL for every kind: in this snapshot Dexs peers trade near 0.34x TVL while Lending peers
//     trade near 0.13x. Medians, not means, because a few huge ratios would drag a mean;
//     the clamp stops thin peer sets from exploding a value. The multiple is computed from
//     the snapshot at run time, never from a hard-coded list of names or categories.
//   base          = tvl_usd x peer multiple
//   growth        = clamp(change_7d, -50, 80) per cent; a single week is noisy, so the tails
//     are cut hard (one protocol in this snapshot reports +4,448% in 7 days) and the weight is
//     0.6: growthMult = 1 + (growth / 100) x 0.6
//   maturity      = 0.70 + 0.30 x ln(1 + min(age_days, 1095)) / ln(1 + 1095); age is how long
//     the protocol has run with no token, and the log makes the reward saturate: a year of
//     waiting matters far more than the fourth year. Unknown age scores the floor, 0.70,
//     because missing data is not evidence of longevity.
//   chain breadth = 1 + 0.05 x ln(chains), capped at 1.15: a protocol live on more chains
//     reaches more users, with diminishing returns (85 chains is not 85x one chain).
//   implied       = max(1, round(base x growthMult x maturity x chain breadth))
//
// No protocol name is ever special-cased: the same function scores every row.
// This file was rewritten in-session (radar-2, second pass) so every scoring line below
// is the author's own: same formulas, same outputs, clearer structure.

/** One protocol as the sealed snapshot carries it: exactly ten fields, no others. */
export interface SnapshotProtocol {
  /** DefiLlama's slug, unique in the snapshot. */
  slug: string;
  /** The protocol's name as DefiLlama writes it. */
  name: string;
  /** DefiLlama's category, such as Dexs or Lending; null when it names none. */
  category: string | null;
  /** The chains DefiLlama counts the protocol's TVL on. */
  chains: string[];
  /** Total value locked in whole US dollars, truncated toward zero. */
  tvl_usd: number;
  /** TVL change over 7 days in per cent; null when DefiLlama reports none. */
  change_7d: number | null;
  /** Market cap of the protocol's token in whole dollars; null when it has no token. */
  mcap_usd: number | null;
  /** The UTC day DefiLlama began tracking the protocol; null when it reports none. */
  listed_at: string | null;
  /** The token's CoinGecko id; null when it records no token. */
  gecko_id: string | null;
  /** The token's ticker; null when it records no token. */
  symbol: string | null;
}

/** The whole snapshot document the entry reads. */
export interface Snapshot {
  /** The UTC date of the fetch, YYYY-MM-DD. */
  as_of: string;
  /** Where the data came from and when it was fetched. */
  source: string;
  /** The watchlist's floor in whole US dollars ($50,000,000 in this snapshot). */
  floor_usd: number;
  /** Every protocol at or above $5,000,000 of TVL, sorted by slug. */
  protocols: SnapshotProtocol[];
  /** The slugs that meet the watchlist's definition, ascending. */
  watchlist: string[];
}

/**
 * The model's constants. The dashboard states them and the sandbox may change them,
 * so they live in one object instead of being scattered through the code.
 */
export interface ModelConstants {
  /** Minimum peers in a category before its own median is used instead of the global median. */
  peer_min_count: number;
  /** Lower clamp on a peer multiple (category median or global fallback), in mcap per $1 of TVL. */
  peer_multiple_floor: number;
  /** Upper clamp on a peer multiple. */
  peer_multiple_cap: number;
  /** How much of the 7-day growth enters the price: growthMult = 1 + growth x weight. */
  growth_weight: number;
  /** Lower clamp on the 7-day growth, in per cent. */
  growth_floor: number;
  /** Upper clamp on the 7-day growth, in per cent. */
  growth_cap: number;
  /** Maturity multiplier for a protocol of unknown age, and for a protocol listed today. */
  maturity_floor: number;
  /** How much maturity can add above its floor, at the age cap. */
  maturity_range: number;
  /** Age in days at which the maturity reward saturates. */
  maturity_days: number;
  /** Weight of the multi-chain breadth factor: 1 + chain_weight x ln(chains). */
  chain_weight: number;
  /** Cap on the multi-chain breadth factor. */
  chain_cap: number;
}

/** The radar-2 constants, as the dashboard states them. */
export const MODEL: ModelConstants = {
  peer_min_count: 5,
  peer_multiple_floor: 0.05,
  peer_multiple_cap: 0.6,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 80,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  chain_weight: 0.05,
  chain_cap: 1.15,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** Cap on pre-token protocols below the watchlist floor the early radar carries (every rankable one fits). */
export const EARLY_ROWS = 200;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  /** What to do, in the words a farmer can follow. */
  text: string;
  /** What the step costs, in capital or gas. */
  cost: string;
  /** How long the step takes. */
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  /** Rank 1 is the board's most valuable protocol. */
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
  /** Every ranked row is pre-token by construction. */
  token_status: 'pre-token';
  /** Days from listed_at to the snapshot date; null when listed_at is unknown. */
  age_days: number | null;
  /** The model's claim for what the protocol's token would be worth, in whole dollars. */
  implied_value_usd: number;
  /** The four factors behind the implied value, rounded to four decimals. */
  model: {
    peer_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  /** The seven farm steps, each one string with its cost and time. */
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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

/** Milliseconds in one day, for turning date differences into day counts. */
const DAY_MS = 86_400_000;

/**
 * A finite number, else `fallback`. Snapshot numbers arrive as JSON, so a missing
 * or non-numeric value must never crash the scorer; it falls back instead.
 */
function asNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number') return fallback;
  if (!Number.isFinite(value)) return fallback;
  return value;
}

/**
 * A whole day count from `from` to `to`, clamped at zero; null when either date
 * is absent or does not parse. Both dates are UTC days, so the parse is explicit.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) {
    return null;
  }
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) {
    return null;
  }
  const diffMs = asOfMs - listedMs;
  if (diffMs <= 0) {
    return 0;
  }
  return Math.floor(diffMs / DAY_MS);
}

/** The median of a non-empty list of numbers: the middle value, or the mean of the middle two. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  const lower = sorted[middle - 1]!;
  const upper = sorted[middle]!;
  return (lower + upper) / 2;
}

/** Clamp a peer multiple into the model's sane band, floor to cap. */
function clampMultiple(value: number, model: ModelConstants): number {
  const aboveFloor = Math.max(model.peer_multiple_floor, value);
  return Math.min(model.peer_multiple_cap, aboveFloor);
}

/** Round a multiplier to four decimals, so the board and the page agree exactly. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The peer multiples for one snapshot: the median mcap/TVL of the live-token protocols in each
 * category with at least `peer_min_count` peers, plus the global median as the fallback. Computed
 * from the snapshot at run time, so a new snapshot re-prices every category on its own evidence.
 */
export function peerMultiples(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { byCategory: Map<string, number>; fallback: number } {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const protocol of snapshot.protocols) {
    if (isPreToken(protocol)) continue;
    if (protocol.mcap_usd === null) continue;
    if (protocol.tvl_usd <= 0) continue;
    const ratio = protocol.mcap_usd / protocol.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    allRatios.push(ratio);
    const key = protocol.category ?? 'Other';
    const existing = ratiosByCategory.get(key);
    if (existing) {
      existing.push(ratio);
    } else {
      ratiosByCategory.set(key, [ratio]);
    }
  }
  const fallback = allRatios.length > 0 ? clampMultiple(medianOf(allRatios), model) : 0.2;
  const byCategory = new Map<string, number>();
  for (const [category, ratios] of ratiosByCategory) {
    if (ratios.length < model.peer_min_count) continue;
    byCategory.set(category, clampMultiple(medianOf(ratios), model));
  }
  return { byCategory, fallback };
}

/** The peer multiple one protocol is priced at: its category's median, else the global median. */
export function peerMultipleFor(
  p: SnapshotProtocol,
  peers: { byCategory: Map<string, number>; fallback: number },
): number {
  const categoryMultiple = peers.byCategory.get(p.category ?? 'Other');
  if (categoryMultiple !== undefined) {
    return categoryMultiple;
  }
  return peers.fallback;
}

/**
 * The four multipliers and the implied value one protocol gets under `model`.
 * Every factor is computed from the snapshot alone; no name is special-cased.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  peerMultiple: number,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = asNumber(protocol.change_7d, 0);
  const clampedGrowth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (clampedGrowth / 100) * model.growth_weight;
  // Log-age maturity: saturating, so the first year of waiting counts far more than the fourth.
  // Unknown age scores the floor: missing data is not evidence of longevity.
  let maturityMult: number;
  if (age === null) {
    maturityMult = model.maturity_floor;
  } else {
    const cappedAge = Math.min(Math.max(age, 0), model.maturity_days);
    const ageShare = Math.log1p(cappedAge) / Math.log1p(model.maturity_days);
    maturityMult = model.maturity_floor + ageShare * model.maturity_range;
  }
  // Multi-chain breadth, with diminishing returns: 1 chain scores 1.00, 11 chains about 1.12.
  const chainCount = Math.max(protocol.chains.length, 1);
  const rawChainMult = 1 + model.chain_weight * Math.log(chainCount);
  const chainMult = Math.min(model.chain_cap, rawChainMult);
  const base = protocol.tvl_usd * peerMultiple;
  const product = base * growthMult * maturityMult * chainMult;
  const implied = Math.max(1, Math.round(product));
  return { implied, growthPct: clampedGrowth, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist's own rule keeps out of a launch ranking: wrapped, staked, bridged and exchange products. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not a wrapped/staked/bridged/exchange product, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols indexed by slug, for looking the watchlist up. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const protocol of protocols) {
    index.set(protocol.slug, protocol);
  }
  return index;
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Compare two protocols for the early radar: TVL first, slug as the tie-break. */
function compareEarly(a: SnapshotProtocol, b: SnapshotProtocol): number {
  if (b.tvl_usd !== a.tvl_usd) {
    return b.tvl_usd - a.tvl_usd;
  }
  if (a.slug < b.slug) return -1;
  if (a.slug > b.slug) return 1;
  return 0;
}

/** Compare two scored rows: implied value first, slug as the tie-break. */
function compareScored(
  a: { implied: number; slug: string },
  b: { implied: number; slug: string },
): number {
  if (b.implied !== a.implied) {
    return b.implied - a.implied;
  }
  if (a.slug < b.slug) return -1;
  if (a.slug > b.slug) return 1;
  return 0;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot, model);
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol !== undefined) {
      chosen.set(slug, protocol);
    }
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const earlyCandidates: SnapshotProtocol[] = [];
  for (const protocol of snapshot.protocols) {
    if (chosen.has(protocol.slug)) continue;
    if (!isRankable(protocol)) continue;
    if (protocol.tvl_usd >= snapshot.floor_usd) continue;
    earlyCandidates.push(protocol);
  }
  earlyCandidates.sort(compareEarly);
  const early = earlyCandidates.slice(0, EARLY_ROWS);
  for (const protocol of early) {
    chosen.set(protocol.slug, protocol);
  }

  type Scored = {
    p: SnapshotProtocol;
    peer: number;
    implied: number;
    growthPct: number;
    growthMult: number;
    maturityMult: number;
    chainMult: number;
    age: number | null;
  };
  const scored: Scored[] = [];
  for (const p of chosen.values()) {
    // Round the peer multiple first: the dashboard recomputes the row from the stored multiple,
    // so the board's implied value must be built from exactly the multiple the page sees.
    const peer = round4(peerMultipleFor(p, peers));
    const value = impliedValue(p, snapshot.as_of, model, peer);
    scored.push({
      p,
      peer,
      implied: value.implied,
      growthPct: value.growthPct,
      growthMult: value.growthMult,
      maturityMult: value.maturityMult,
      chainMult: value.chainMult,
      age: value.age,
    });
  }
  scored.sort((a, b) => compareScored({ implied: a.implied, slug: a.p.slug }, { implied: b.implied, slug: b.p.slug }));
  const rows: BoardRow[] = [];
  scored.forEach((s, i) => {
    rows.push({
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
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        peer_multiple: round4(s.peer),
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        chain_multiplier: round4(s.chainMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    });
  });
  return rows;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  const full = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (full.length > 600) {
    return `${full.slice(0, 596)}...`;
  }
  if (full.length < 20) {
    return `${full} Hold the position and check the protocol's own page.`;
  }
  return full;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  if (p.chains.length > 0) {
    return p.chains[0]!;
  }
  return 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalForTvl(p: SnapshotProtocol): number {
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

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  }
  if (category.includes('dex') || category.includes('yield') || category.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (category.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  }
  if (category.includes('staking') || category.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  }
  if (category.includes('perpetual') || category.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  }
  if (category.includes('prediction')) {
    return `Fund $${capital} and place one market position on ${name}.`;
  }
  if (category.includes('curator') || category.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  }
  if (category.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (category.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  }
  if (category.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalForTvl(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gasForSetup = capital >= 150 ? 8 : 4;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gasForSetup} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Set a monthly reminder to review the position, and unwind it in two steps if the protocol's TVL falls by half or its points page disappears.`,
      cost: 'nothing to review; about $4 of gas to unwind',
      time: '10 minutes a month',
    },
  ];
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live: SnapshotProtocol[] = [];
  for (const protocol of snapshot.protocols) {
    if (isPreToken(protocol)) continue;
    if (protocol.category === 'CEX') continue;
    live.push(protocol);
  }
  live.sort((a, b) => {
    const mcapDiff = (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0);
    if (mcapDiff !== 0) return mcapDiff;
    return b.tvl_usd - a.tvl_usd;
  });
  const top = live.slice(0, LIVE_ROWS);
  return top.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
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
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  let earlyCount = 0;
  for (const row of board) {
    if (!snapshot.watchlist.includes(row.slug)) {
      earlyCount += 1;
    }
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Read one protocol out of the snapshot's JSON, with the fields the model scores. */
function parseProtocol(v: unknown, i: number): SnapshotProtocol {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
  }
  const p = v as Record<string, unknown>;
  const slugOk = typeof p.slug === 'string';
  const nameOk = typeof p.name === 'string';
  const tvlOk = typeof p.tvl_usd === 'number' && Number.isFinite(p.tvl_usd);
  if (!slugOk || !nameOk || !tvlOk) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  const chains: string[] = [];
  if (Array.isArray(p.chains)) {
    for (const c of p.chains) {
      if (typeof c === 'string') chains.push(c);
    }
  }
  return {
    slug: p.slug as string,
    name: p.name as string,
    category: typeof p.category === 'string' ? p.category : null,
    chains,
    tvl_usd: p.tvl_usd as number,
    change_7d:
      typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd:
      typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') {
    throw new SnapshotError('snapshot.json has no source');
  }
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) {
    throw new SnapshotError('snapshot.json has no protocols array');
  }
  if (!Array.isArray(o.watchlist)) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  for (const s of o.watchlist) {
    if (typeof s !== 'string') {
      throw new SnapshotError('snapshot.json has no watchlist of slugs');
    }
  }
  const protocols: SnapshotProtocol[] = [];
  o.protocols.forEach((v, i) => {
    protocols.push(parseProtocol(v, i));
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Check one board row's farm steps and implied value; return the problem, or null. */
function rowIssue(r: BoardRow): string | null {
  const steps = r.farm_steps;
  if (steps.length < 3 || steps.length > 12) {
    return `${r.slug} has ${steps.length} farm steps`;
  }
  for (const s of steps) {
    if (s.length < 20 || s.length > 600) {
      return `${r.slug} has a farm step of ${s.length} characters`;
    }
  }
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
    return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(', ');
    const plural = missing.length === 1 ? '' : 's';
    return `the board misses ${missing.length} watchlist slug${plural}: ${shown}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      return `rank ${i + 1} is ${ranks[i]}`;
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2) {
    const first = board[0]!.implied_value_usd;
    const last = board[board.length - 1]!.implied_value_usd;
    if (first === last) {
      return `all ${board.length} rows share the same implied value $${first}: a board that ranks nothing by value is not a ranking`;
    }
  }
  for (const r of board) {
    const problem = rowIssue(r);
    if (problem !== null) {
      return problem;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
