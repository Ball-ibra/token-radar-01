# Token Radar — radar-2 model

Entry for make.fun competition `token-radar-01` (deadline 2026-12-14T10:00:00Z).
Planned repo: https://github.com/Ball-ibra/token-radar-01 (owner Ball-ibra, verified
on GitHub 2026-11-19; the earlier "Ball_ibra" spelling was wrong).

## What changed vs the starter (radar-1)

The starter priced every protocol at a flat 25% of TVL. radar-2 prices each protocol
from the snapshot's own live-token evidence, and only from the snapshot:

```
implied = round( tvl_usd x peer multiple
               x (1 + clamp(change_7d, -50, 80) / 100 x 0.6)
               x (0.70 + 0.30 x ln(1 + min(age_days, 1095)) / ln(1 + 1095))
               x min(1.15, 1 + 0.05 x ln(chains)) )
```

- **Peer multiple** — the median market-cap/TVL of the snapshot's live-token protocols
  in the same category (≥5 peers, else the global median), clamped to 0.05–0.60.
  Computed from the snapshot at run time, never hard-coded. This snapshot:
  Dexs 0.3424, RWA 0.2748, Yield 0.1914, Lending 0.1324, Bridge 0.5567,
  CEX 0.0748, Liquid Staking 0.05 (clamped), Basis Trading 0.60 (clamped),
  Canonical Bridge 0.60 (clamped), global fallback 0.2138. Medians, not means:
  a few huge ratios would drag a mean, and the clamp stops thin peer sets
  (e.g. Risk Curators, 1 live peer at 2.97x) from exploding a value.
- **Growth** — 7-day TVL change, clamped to −50…+80% at weight 0.6. One week is
  noisy: one protocol in this snapshot reports +4,448% in 7 days.
- **Maturity (log-age)** — how long the protocol has run with no token, saturating:
  the first year of waiting counts far more than the fourth. Unknown `listed_at`
  scores the floor (0.70); missing data is not evidence of longevity.
- **Chain breadth** — `1 + 0.05 x ln(chains)`, capped at 1.15: multichain reach
  with diminishing returns (85 chains is not 85x one chain).
- **Cleaner ranking** — the board applies the watchlist's own exclusion to the
  early rows too (Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking,
  Restaked BTC, CEX, versioned names): a wrapped/staked product of a token that
  already trades is not a launch candidate.
- **Farm plans** — 7 steps (was 6), each with a cost and a time; added a monthly
  review / unwind trigger. The page (`dashboard/app.js`) derives the same plan
  and recomputes the same implied value as `board.json` — verified for all rows.
- **Board** — 183 rows: all 40 watchlist protocols + 143 rankable pre-token
  protocols below the $50M floor (every rankable one, not a top-160 cut).
  24 live-token protocols are set aside with their market caps.

## Local run (Node 24.22.1; kit harness is Node 26 — no incompatibility seen)

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
# token radar: 758 protocols, 40 on the watchlist, 183 rows scored (143 early, 24 live set aside)
```

Two runs are byte-identical (the grader runs the program twice).
Screenshots were captured from the built dashboard with headless Chromium
(Playwright, installed only as a screenshot tool outside this repo):
`1-board.png` (board, 183 rows), `2-detail.png` (Steakhouse Financial detail),
`3-filtered.png` (RWA filter, 15 rows) — all 1440x900, each under the 512 KiB cap.

## Kit check (from inside the unpacked kit)

```sh
node cli/makefun.mjs check --kit . --repo <this dir> --worktree [--transcripts transcripts.tar.gz]
```

Last run: 4 passed (competition_open, snapshot, license_osi MIT, entrypoint node22),
1 failed — `transcripts_present` (no bundle yet; see below) — the rest skipped
or checked at submission (repo must be public, created after 2026-11-14, carry
`.makefun/owner.json` with wallet `6eeF4B9WhjFb2sCHohCAF4ur3YfYFFUvmGetkafm6ann`,
or be owned by the account's GitHub login).

## What remains (not done by this build)

1. Create the GitHub repo **https://github.com/Ball-ibra/token-radar-01** (public,
   created after 2026-11-14), push this directory, add `.makefun/owner.json`
   `{"wallet": "6eeF4B9WhjFb2sCHohCAF4ur3YfYFFUvmGetkafm6ann"}`, and set the repo
   README (make.fun badges) + About (website on make.fun, topic `makefun`).
2. Bundle transcripts — run from the **top-level agent** after all subagents finish:
   `node cli/makefun.mjs bundle --repo <repo> --system-prompt <file> --effort <level> --out transcripts.tar.gz`
   (redact personal details with `--redact`; this build's sessions must be included).
3. Re-run `check` with the bundle, then submit (escrowed prizes — entry is signed):
   `node cli/makefun.mjs submit --competition token-radar-01 --repo-url https://github.com/Ball-ibra/token-radar-01 --commit <sha> --title "Token Radar" --bundle transcripts.tar.gz --keypair ~/workspace/makefun/makefun-keypair.json`
4. Follow it: `node cli/makefun.mjs status --submission <id>`.
