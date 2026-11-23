// Launch-Odds Radar v11 — model radar-11, written fresh for this entry.
//
// What it does, in one paragraph: the snapshot's 95 labelled protocols (a token
// on record, market cap above zero, a listing date) teach a ridge model the
// log10 ratio of market cap to TVL, winsorized to 0.1x-10x so one 400x outlier
// cannot steer the fit. That ratio, times a pre-token protocol's TVL, is its
// implied value. A second, separate odds head estimates the chance a launch
// lands above the labelled median ratio. Everything is selected by held-out
// error only (leave-one-out, walk-forward, 5-fold); nothing is tuned on the
// full fit. Category token-rate — the mean ratio of a protocol's own category
// — is self-leakage and is NEVER a feature: a category's label may enter as a
// dummy (what the category means), never its labelled outcome.
//
// Features (snapshot fields only): log10 TVL and its square, 7-day growth
// clamped to [-60, 120] and its square, log10 age in days (365 when unlisted),
// log10 chain count, log10 TVL per chain, a missing-growth flag, and 8
// semantic category-group flags (stake / trade / lend / bridge / rwa / yield /
// stable / infra, matched on what the category name means). The ratio head
// adds one dummy per exact category label present in the labelled set
// (shrunk by the same ridge penalty); the odds head does not, because exact
// dummies wrecked its calibration in held-out tests (Brier 0.30 vs 0.21).

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export class SnapshotError extends Error {
  constructor(m: string) { super(m); this.name = 'SnapshotError'; }
}

export const MODEL_VERSION = 'radar-11';
export const RIDGE_LAMBDA = 30;
export const LOGIT_LAMBDA = 30;
export const WINSOR_LO = -1; // log10 0.1x
export const WINSOR_HI = 1;  // log10 10x
export const EARLY_ROWS = 158; // 40 watchlist + 158 early = 198 board rows
export const LIVE_ROWS = 24;
export const DEPOSIT_PCT_FRAC = 0.0002; // 0.02% of implied value
export const DEPOSIT_MIN = 25; export const DEPOSIT_MAX = 500;
export const GAS_USD = 15; export const OPP_RATE = 0.05; // opportunity cost on capital
export const ALLOC_SHARE = 0.10; // share of implied value assumed paid to farmers
export const INTERVAL_INFLATION = 1.15; // finite-sample widening of LOO intervals (n=95)

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const log10 = (v: number) => Math.log10(Math.max(v, 1));
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`), b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}
export function isLabelled(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.listed_at !== null;
}
export function ratioTarget(p: SnapshotProtocol): number {
  return clamp(Math.log10((p.mcap_usd as number) / p.tvl_usd), WINSOR_LO, WINSOR_HI);
}

// Semantic groups: what the category MEANS, not its labelled outcome.
const GROUPS: Array<[string, string[]]> = [
  ['stake', ['stak', 'liquid']],
  ['trade', ['dex', 'deriv', 'perpetual', 'prediction', 'options']],
  ['lend', ['lend', 'cdp', 'collateral', 'borrow']],
  ['bridge', ['bridge']],
  ['rwa', ['rwa', 'real world']],
  ['yield', ['yield', 'farm', 'vault', 'curator', 'allocator']],
  ['stable', ['stable']],
  ['infra', ['infra', 'oracle', 'wallet']],
];
function groupFlags(p: SnapshotProtocol): number[] {
  const c = (p.category ?? '').toLowerCase();
  return GROUPS.map(([, keys]) => (keys.some((k) => c.includes(k)) ? 1 : 0));
}
/** Base design row (intercept first). Shared by both heads. */
export function baseFeatures(p: SnapshotProtocol, asOf: string): number[] {
  const lt = log10(p.tvl_usd);
  const g = p.change_7d === null ? 0 : clamp(p.change_7d, -60, 120);
  const gf = g / 100;
  const age = ageDays(asOf, p.listed_at);
  const la = log10(age === null ? 365 : Math.max(age, 1));
  const nc = Math.max(p.chains.length, 1);
  return [1, lt, lt * lt, gf, gf * gf, la, log10(nc), lt / nc, p.change_7d === null ? 1 : 0, ...groupFlags(p)];
}
/** Exact-category dummies, one column per label in `labels` (unknown label: all zero). */
export function categoryDummies(p: SnapshotProtocol, labels: string[]): number[] {
  return labels.map((l) => ((p.category ?? 'None') === l ? 1 : 0));
}

// ---- small linear algebra (standard library only) ----
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    const tmp = M[col]!; M[col] = M[piv]!; M[piv] = tmp;
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[n]! / (Math.abs(row[i]!) < 1e-12 ? 1 : row[i]!));
}
export interface RidgeModel { w: number[]; mu: number[]; sd: number[]; }
export function ridgeFit(X: number[][], y: number[], lam: number): RidgeModel {
  const d = X[0]!.length;
  const mu: number[] = [], sd: number[] = [];
  for (let j = 1; j < d; j++) {
    const col = X.map((r) => r[j]!);
    const m = col.reduce((a, b) => a + b, 0) / col.length;
    const s = Math.sqrt(col.reduce((a, b) => a + (b - m) * (b - m), 0) / col.length) || 1;
    mu.push(m); sd.push(s);
  }
  const Xs = X.map((r) => [1, ...r.slice(1).map((v, j) => (v - mu[j]!) / sd[j]!)]);
  const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const b: number[] = new Array(d).fill(0);
  for (let i = 0; i < Xs.length; i++) {
    const xi = Xs[i]!;
    for (let a = 0; a < d; a++) { b[a]! += xi[a]! * y[i]!; for (let c = 0; c < d; c++) A[a]![c]! += xi[a]! * xi[c]!; }
  }
  for (let j = 1; j < d; j++) A[j]![j]! += lam;
  return { w: solveLinear(A, b), mu, sd };
}
export function ridgePredict(model: RidgeModel, X: number[][]): number[] {
  return X.map((r) => {
    const xs = [1, ...r.slice(1).map((v, j) => (v - model.mu[j]!) / model.sd[j]!)];
    return xs.reduce((a, v, j) => a + v * model.w[j]!, 0);
  });
}
// Logistic head (Newton, ridge penalty on slopes only).
export interface LogitModel { w: number[]; mu: number[]; sd: number[]; }
export function logitFit(X: number[][], t: number[], lam: number): LogitModel {
  const d = X[0]!.length;
  const mu: number[] = [], sd: number[] = [];
  for (let j = 1; j < d; j++) {
    const col = X.map((r) => r[j]!);
    const m = col.reduce((a, b) => a + b, 0) / col.length;
    const s = Math.sqrt(col.reduce((a, b) => a + (b - m) * (b - m), 0) / col.length) || 1;
    mu.push(m); sd.push(s);
  }
  const Xs = X.map((r) => [1, ...r.slice(1).map((v, j) => (v - mu[j]!) / sd[j]!)]);
  const p0 = t.reduce((a, b) => a + b, 0) / t.length;
  let w: number[] = new Array(d).fill(0); w[0] = Math.log(p0 / (1 - p0));
  for (let it = 0; it < 50; it++) {
    const g = new Array(d).fill(0);
    const H: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < Xs.length; i++) {
      const z = Xs[i]!.reduce((a, v, j) => a + v * w[j]!, 0);
      const pr = 1 / (1 + Math.exp(-clamp(z, -30, 30)));
      const e = pr - t[i]!;
      const v = pr * (1 - pr);
      for (let a = 0; a < d; a++) { g[a]! += Xs[i]![a]! * e; for (let c = 0; c < d; c++) H[a]![c]! += Xs[i]![a]! * Xs[i]![c]! * v; }
    }
    for (let j = 1; j < d; j++) { g[j]! += lam * w[j]!; H[j]![j]! += lam; }
    const step = solveLinear(H, g);
    w = w.map((v, j) => v - step[j]!);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return { w, mu, sd };
}
export function logitPredict(model: LogitModel, X: number[][]): number[] {
  return X.map((r) => {
    const xs = [1, ...r.slice(1).map((v, j) => (v - model.mu[j]!) / model.sd[j]!)];
    const z = xs.reduce((a, v, j) => a + v * model.w[j]!, 0);
    return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
  });
}
export function normalCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
export function geoMiss(pred: number[], actual: number[]): number {
  const mean = pred.reduce((a, p, i) => a + Math.abs(p - actual[i]!), 0) / pred.length;
  return Math.pow(10, mean);
}
export function medMiss(pred: number[], actual: number[]): number {
  const s = pred.map((p, i) => Math.abs(p - actual[i]!)).sort((a, b) => a - b);
  return Math.pow(10, s[Math.floor(s.length / 2)]!);
}
export function aucScore(score: number[], t: number[]): number {
  const order = score.map((s, i) => i).sort((a, b) => score[a]! - score[b]!);
  const rank = new Array(score.length).fill(0);
  order.forEach((idx, k) => { rank[idx] = k + 1; });
  const n1 = t.reduce((a, b) => a + b, 0), n0 = t.length - n1;
  const sum = t.reduce((a, v, i) => a + (v === 1 ? rank[i]! : 0), 0);
  return (sum - n1 * (n1 + 1) / 2) / (n1 * n0);
}
export function brierScore(p: number[], t: number[]): number {
  return p.reduce((a, v, i) => a + (v - t[i]!) * (v - t[i]!), 0) / p.length;
}
/** Deterministic PRNG (mulberry32) — a plain LCG shuffle has poor low bits. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Deterministic seeded permutation (Fisher-Yates with mulberry32). */
export function seededPerm(n: number, seed: number): number[] {
  const rnd = mulberry32(seed);
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i]!; a[i] = a[j]!; a[j] = tmp;
  }
  return a;
}

// ---- farm economics + steps ----
export function depositFor(implied: number): number {
  return clamp(DEPOSIT_PCT_FRAC * implied, DEPOSIT_MIN, DEPOSIT_MAX);
}
export function economics(implied: number, tvl: number): { deposit: number; ev: number; gas: number; opp: number; net: number; verdict: string } {
  const deposit = depositFor(implied);
  const ev = ALLOC_SHARE * implied * deposit / Math.max(tvl, 1);
  const opp = OPP_RATE * deposit;
  const net = ev - GAS_USD - opp;
  const verdict = net > 0 ? 'FARM' : net > -15 ? 'THIN' : 'SKIP';
  return { deposit, ev, gas: GAS_USD, opp, net, verdict };
}
function chainOf(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains[0]! : 'its main chain'; }
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase(), name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}
export interface FarmStep { text: string; cost: string; time: string; }
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: { deposit: number; ev: number; net: number; verdict: string }): string[] {
  const chain = chainOf(p), capital = capitalFor(p), hold = holdDaysFor(age);
  const dep = Math.round(econ.deposit);
  const steps: FarmStep[] = [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: `Check ${p.name} on ${chain}: confirm it still records no token and that its points or rewards page is live before sending funds.`, cost: 'no fee to check', time: '10 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: `Size the farm position to $${dep} (the model's deposit for this row) and do not exceed it on the first pass.`, cost: `$${dep} of capital`, time: '5 minutes' },
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Track the expected value: about $${econ.ev.toFixed(2)} of airdrop value against $${(GAS_USD + OPP_RATE * econ.deposit).toFixed(2)} of costs, net $${econ.net.toFixed(2)} (${econ.verdict}).`, cost: 'nothing but the log', time: '5 minutes' },
    { text: `If the protocol announces a token, snapshot or claim window, read its own announcement before acting.`, cost: 'no fee to check', time: '10 minutes' },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
  return steps.map(stepText);
}

// ---- board ----
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null; token_status: 'pre-token';
  age_days: number | null; implied_value_usd: number; pred_log_ratio: number;
  odds: number; imp_lo_usd: number; imp_hi_usd: number; rank_lo: number; rank_hi: number;
  deposit_usd: number; ev_usd: number; net_usd: number; verdict: string; farm_steps: string[];
}
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}
export interface Metrics {
  labelled_n: number; loo_geo: number; loo_med: number; wf_geo: number; wf_med: number;
  fold_strat_worst: number; fold_seq_worst: number; fold_rand_worst: number;
  cov_p25_p75: number; cov_p10_p90: number; sigma_loo: number; median_ratio_log: number;
  auc: number; brier: number; farm: number; thin: number; skip: number;
}
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model_version: string;
  anchor_round: number; watchlist_size: number; board_size: number; early_size: number;
  live_size: number; set_aside_size: number; total_protocols: number;
  deposit_pct: number; deposit_pct_frac: number; deposit_min: number; deposit_max: number;
  gas_usd: number; alloc_share: number; opp_rate: number;
  metrics: Metrics; rows: BoardRow[]; live: LiveRow[];
  fold_table: Array<{ kind: string; worst_geo: number }>;
}

/** Evaluate the two heads by held-out error only. Returns every number the dashboard shows. */
export function evaluate(snapshot: Snapshot): { metrics: Metrics; foldTable: Array<{ kind: string; worst_geo: number }>; medianLog: number; sigmaBase: number } {
  const labelled = snapshot.protocols.filter(isLabelled);
  const y = labelled.map(ratioTarget);
  const Xb = labelled.map((p) => baseFeatures(p, snapshot.as_of));
  const labels = [...new Set(labelled.map((p) => p.category ?? 'None'))].sort();
  const Xe = labelled.map((p, i) => [...Xb[i]!, ...categoryDummies(p, labels)]);
  const n = labelled.length;
  const order = labelled.map((_, i) => i).sort((a, b) =>
    (labelled[a]!.listed_at! < labelled[b]!.listed_at! ? -1 : labelled[a]!.listed_at! > labelled[b]!.listed_at! ? 1 : labelled[a]!.slug < labelled[b]!.slug ? -1 : 1));
  const tr66 = order.slice(0, 66), te29 = order.slice(66);
  const medianLog = [...y].sort((a, b) => a - b)[Math.floor(n / 2)]!;
  const t = y.map((v) => (v > medianLog ? 1 : 0));
  // LOO ratio head (exact-category ridge)
  const loo: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const idx = labelled.map((_, k) => k).filter((k) => k !== i);
    const m = ridgeFit(idx.map((k) => Xe[k]!), idx.map((k) => y[k]!), RIDGE_LAMBDA);
    loo[i] = ridgePredict(m, [Xe[i]!])[0]!;
  }
  const resid = y.map((v, i) => v - loo[i]!);
  const sigma = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / n);
  const sigmaBase = (() => {
    const looB: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const idx = labelled.map((_, k) => k).filter((k) => k !== i);
      const m = ridgeFit(idx.map((k) => Xb[k]!), idx.map((k) => y[k]!), RIDGE_LAMBDA);
      looB[i] = ridgePredict(m, [Xb[i]!])[0]!;
    }
    const r = y.map((v, i) => v - looB[i]!);
    return { looB, sig: Math.sqrt(r.reduce((a, v) => a + v * v, 0) / n) };
  })();
  // Walk-forward (66 older train, 29 newer test)
  const wfModel = ridgeFit(tr66.map((k) => Xe[k]!), tr66.map((k) => y[k]!), RIDGE_LAMBDA);
  const wfPred = ridgePredict(wfModel, te29.map((k) => Xe[k]!));
  const wfActual = te29.map((k) => y[k]!);
  // 5-fold worst geo, three foldings
  const foldKinds: Array<{ kind: string; folds: number[][] }> = [];
  const qs = y.map((_, i) => i).sort((a, b) => y[a]! - y[b]!);
  const strat: number[][] = [[], [], [], [], []];
  qs.forEach((idx, k) => { strat[k % 5]!.push(idx); });
  foldKinds.push({ kind: 'stratified', folds: strat });
  foldKinds.push({ kind: 'sequential', folds: [0, 1, 2, 3, 4].map((f) => order.slice(f * 19, (f + 1) * 19)) });
  const perm = seededPerm(n, 42);
  foldKinds.push({ kind: 'random-42', folds: [0, 1, 2, 3, 4].map((f) => perm.slice(f * 19, (f + 1) * 19)) });
  const foldTable = foldKinds.map(({ kind, folds }) => {
    let worst = 0;
    for (const te of folds) {
      const teSet = new Set(te);
      const tr = labelled.map((_, k) => k).filter((k) => !teSet.has(k));
      const m = ridgeFit(tr.map((k) => Xe[k]!), tr.map((k) => y[k]!), RIDGE_LAMBDA);
      const p = ridgePredict(m, te.map((k) => Xe[k]!));
      worst = Math.max(worst, geoMiss(p, te.map((k) => y[k]!)));
    }
    return { kind, worst_geo: round4(worst) };
  });
  // Odds head: repeated 5-fold out-of-fold logistic (4 repeats, strided folds;
  // averaging repeats cuts partition noise) + LOO normal head from the BASE
  // ridge, averaged 50/50.
  const oofLog: number[] = new Array(n).fill(0);
  for (let rep = 0; rep < 4; rep++) {
    const permR = seededPerm(n, 42 + rep);
    for (let f = 0; f < 5; f++) {
      const te: number[] = [];
      for (let k = f; k < n; k += 5) te.push(permR[k]!);
      const teSet = new Set(te);
      const tr = labelled.map((_, k) => k).filter((k) => !teSet.has(k));
      const m = logitFit(tr.map((k) => Xb[k]!), tr.map((k) => t[k]!), LOGIT_LAMBDA);
      const p = logitPredict(m, te.map((k) => Xb[k]!));
      te.forEach((k, j) => { oofLog[k] += p[j]! / 4; });
    }
  }
  const pNorm = sigmaBase.looB.map((v) => normalCdf((v - medianLog) / sigmaBase.sig));
  const pEns = oofLog.map((v, i) => 0.5 * v + 0.5 * pNorm[i]!);
  const auc = aucScore(pEns, t);
  const brier = brierScore(pEns, t);
  const cov2575 = resid.filter((r) => Math.abs(r) <= 0.6745 * sigma * INTERVAL_INFLATION).length / n;
  const cov1090 = resid.filter((r) => Math.abs(r) <= 1.6449 * sigma * INTERVAL_INFLATION).length / n;
  const metrics: Metrics = {
    labelled_n: n,
    loo_geo: round4(geoMiss(loo, y)), loo_med: round4(medMiss(loo, y)),
    wf_geo: round4(geoMiss(wfPred, wfActual)), wf_med: round4(medMiss(wfPred, wfActual)),
    fold_strat_worst: foldTable[0]!.worst_geo, fold_seq_worst: foldTable[1]!.worst_geo,
    fold_rand_worst: foldTable[2]!.worst_geo,
    cov_p25_p75: round4(cov2575), cov_p10_p90: round4(cov1090),
    sigma_loo: round4(sigma), median_ratio_log: round4(medianLog),
    auc: round4(auc), brier: round4(brier), farm: 0, thin: 0, skip: 0,
  };
  return { metrics, foldTable, medianLog, sigmaBase: sigmaBase.sig };
}

export function buildRadar(snapshot: Snapshot, anchorRound: number): { board: BoardRow[]; radar: RadarData } {
  const { metrics, foldTable, medianLog, sigmaBase } = evaluate(snapshot);
  const labelled = snapshot.protocols.filter(isLabelled);
  const y = labelled.map(ratioTarget);
  const XbLab = labelled.map((p) => baseFeatures(p, snapshot.as_of));
  const labels = [...new Set(labelled.map((p) => p.category ?? 'None'))].sort();
  const XeLab = labelled.map((p, i) => [...XbLab[i]!, ...categoryDummies(p, labels)]);
  const ratioModel = ridgeFit(XeLab, y, RIDGE_LAMBDA);
  const baseModel = ridgeFit(XbLab, y, RIDGE_LAMBDA);
  const t = y.map((v) => (v > medianLog ? 1 : 0));
  const logitModel = logitFit(XbLab, t, LOGIT_LAMBDA);
  // Board: watchlist first, then early pre-token below the floor by TVL.
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  const picked = [...chosen.values()];
  const XbPick = picked.map((p) => baseFeatures(p, snapshot.as_of));
  const XePick = picked.map((p, i) => [...XbPick[i]!, ...categoryDummies(p, labels)]);
  const pred = ridgePredict(ratioModel, XePick).map((v) => clamp(v, WINSOR_LO, WINSOR_HI));
  const predBase = ridgePredict(baseModel, XbPick);
  const oddsLog = logitPredict(logitModel, XbPick);
  const odds = oddsLog.map((v, i) => 0.5 * v + 0.5 * normalCdf((predBase[i]! - medianLog) / sigmaBase));
  // Bootstrap rank ranges: 40 resamples of the labelled set, refit, re-rank.
  const B = 40;
  const rankLo = new Array(picked.length).fill(198);
  const rankHi = new Array(picked.length).fill(1);
  const implied0 = pred.map((v, i) => picked[i]!.tvl_usd * Math.pow(10, v));
  for (let b = 0; b < B; b++) {
    const rndB = mulberry32(777 + b * 131);
    const idx: number[] = [];
    for (let k = 0; k < labelled.length; k++) idx.push(Math.floor(rndB() * labelled.length));
    const m = ridgeFit(idx.map((k) => XeLab[k]!), idx.map((k) => y[k]!), RIDGE_LAMBDA);
    const pb = ridgePredict(m, XePick).map((v) => clamp(v, WINSOR_LO, WINSOR_HI));
    const impB = pb.map((v, i) => picked[i]!.tvl_usd * Math.pow(10, v));
    const orderB = impB.map((v, i) => i).sort((a, c) => impB[c]! - impB[a]! || (picked[a]!.slug < picked[c]!.slug ? -1 : 1));
    orderB.forEach((idx2, r) => {
      rankLo[idx2] = Math.min(rankLo[idx2]!, r + 1);
      rankHi[idx2] = Math.max(rankHi[idx2]!, r + 1);
    });
  }
  const sigma = metrics.sigma_loo;
  const scored = picked.map((p, i) => {
    const implied = Math.max(1, Math.round(implied0[i]!));
    const age = ageDays(snapshot.as_of, p.listed_at);
    const econ = economics(implied, p.tvl_usd);
    const lo = Math.max(1, Math.round(p.tvl_usd * Math.pow(10, pred[i]! - 1.6449 * sigma * INTERVAL_INFLATION)));
    const hi = Math.max(1, Math.round(p.tvl_usd * Math.pow(10, pred[i]! + 1.6449 * sigma * INTERVAL_INFLATION)));
    return {
      p, age, implied, pred: pred[i]!, odds: odds[i]!, lo, hi,
      rankLo: rankLo[i]!, rankHi: rankHi[i]!, econ,
      steps: farmSteps(p, age, econ),
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
    tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at, gecko_id: s.p.gecko_id, symbol: s.p.symbol,
    token_status: 'pre-token', age_days: s.age, implied_value_usd: s.implied,
    pred_log_ratio: round4(s.pred), odds: round4(s.odds),
    imp_lo_usd: s.lo, imp_hi_usd: s.hi, rank_lo: s.rankLo, rank_hi: s.rankHi,
    deposit_usd: Math.round(s.econ.deposit), ev_usd: round4(s.econ.ev),
    net_usd: round4(s.econ.net), verdict: s.econ.verdict, farm_steps: s.steps,
  }));
  metrics.farm = board.filter((r) => r.verdict === 'FARM').length;
  metrics.thin = board.filter((r) => r.verdict === 'THIN').length;
  metrics.skip = board.filter((r) => r.verdict === 'SKIP').length;
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(),
    floor_usd: snapshot.floor_usd, model_version: MODEL_VERSION, anchor_round: anchorRound,
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: early.length, live_size: live.length,
    set_aside_size: preToken - board.length, total_protocols: snapshot.protocols.length,
    deposit_pct: DEPOSIT_PCT_FRAC * 100, deposit_pct_frac: DEPOSIT_PCT_FRAC,
    deposit_min: DEPOSIT_MIN, deposit_max: DEPOSIT_MAX, gas_usd: GAS_USD,
    alloc_share: ALLOC_SHARE, opp_rate: OPP_RATE,
    metrics, rows: board, live, fold_table: foldTable,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
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
      slug: p.slug, name: p.name,
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
