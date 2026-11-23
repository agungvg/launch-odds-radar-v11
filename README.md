# Launch-Odds Radar v11

[![Rank](https://make.fun/badge/token-radar-01/agungvg/launch-odds-radar-v11/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/agungvg/launch-odds-radar-v11/reward.svg)](https://make.fun/bounty/token-radar-01)
[![Bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)

Build the best token launch radar — a dashboard that ranks pre-token protocols by implied value and shows how to farm each one. Entry for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on make.fun. Referral code: `p9r33tb4`.

## What it does

- Ranks 198 pre-token protocols (the 40-protocol watchlist plus 158 early ones below the floor) by implied value: TVL × 10^predicted log10(market cap / TVL).
- Model **radar-11**: ridge (λ=30) on snapshot-only features — log TVL, growth, age with no token, chain count, semantic category groups, exact-category dummies — target winsorized to 0.1×–10×. A separate odds head estimates P(ratio above the labelled median) from a logistic head + a normal head, averaged 50/50.
- Every verdict is net of fees: deposit = 0.02% of implied value clamped to $25–$500, expected value = 10% of implied × deposit / TVL, costs = $15 gas + 5% of deposit. FARM only when net > 0.
- Evidence on the board, held-out only: LOO ×2.79, walk-forward ×2.85 (66 older / 29 newer), worst 5-fold ×3.95, P25–P75 coverage 61.1%, P10–P90 91.6%, AUC 0.726, Brier 0.216. Two targets miss honestly (walk-forward ≤ ×2.53, AUC ≥ 0.79) and are shown as MISS on the dashboard, not hidden.
- Light theme with pronounced 3D depth: tilted hero and KPI cards, layered shadows, glossy raised surfaces. Board, detail view (10-step farm plan with cost + time, deposit grid + exit rule, peers, scatter), filters, sliders on the model's own scale, CSV/JSON export.
- Anchor: drand quicknet round **34196476** (init root `1958103b65c6bc1fc62c2fdd3435e8b30528d346`), shown in the dashboard footer and integrity strip.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22, standard library only, no network. The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory, deterministically — two runs write identical bytes.

## Files

- `main.ts` — entrypoint (anchor round 34196476)
- `lib/model.ts` — radar-11: features, ridge + logistic heads, held-out evaluation, farm economics, board builder
- `dashboard/` — static page (index.html, app.css, app.js), no network
- `screenshots/` — board, detail, filtered views (1280×800)
- `vendor/makefun-board.ts` — make.fun dossier library from the kit
