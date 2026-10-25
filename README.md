# ChainLens

Read-only multichain wallet intelligence and security forensics powered by live Blockscout v2 public chain data across **10+ EVM networks**.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/frontend run dev` — run the ChainLens web app
- `pnpm --filter @workspace/api-server exec tsx --test src/lib/__tests__/*.test.ts` — run unit tests for address poisoning detection, approval detection, and linkability scoring
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the API server
- `pnpm --filter @workspace/frontend run typecheck` — typecheck the ChainLens app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Optional secret: `BLOCKSCOUT_PRO_API_KEY` — if configured in Env Secrets, the API server uses Blockscout PRO endpoints first and automatically falls back to official public Blockscout v2 instances if unset or rate-limited.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React, Vite, Tailwind CSS, Recharts
- API: Express 5
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/frontend/` — ChainLens dashboard UI, historical charts, linkability breakdown, and Blockscout verification links
- `artifacts/api-server/src/lib/blockscout.ts` — parallel 10-chain Blockscout v2 client, calldata approval parser, address poisoning detector, linkability engine, and historical chart builder
- `artifacts/api-server/src/lib/__tests__/blockscout.test.ts` — unit tests for core forensics logic (address poisoning, approval detection, and linkability score)
- `artifacts/api-server/src/routes/chainlens.ts` — ChainLens API routes
- `.github/workflows/keep-alive.yml` — scheduled keep-alive workflow pinging `/api/healthz` and `/api/blockscout/status` every 10 minutes
- `lib/api-spec/openapi.yaml` — source-of-truth API contract; generated client and Zod types live in `lib/api-client-react/` and `lib/api-zod/`

## Architecture decisions

- **10 EVM Chains in Parallel:** Wallet overview queries **Ethereum (1), Optimism (10), Arbitrum (42161), Base (8453), Polygon (137), Gnosis (100), zkSync Era (324), Scroll (534352), Linea (59144), and Celo (42220)** concurrently via `Promise.allSettled`.
- **Fast, Bounded Execution:** Eliminated sequential request delays and N+1 `/logs` calls. Token approvals (`approve`, `increaseAllowance`, `setApprovalForAll`) and allowance bounds (`Unlimited`, `Bounded`, `Revoked`) are parsed directly from transaction `decoded_input` and `raw_input` calldata.
- **Strict Timeouts & Resilience:** Enforces a `6s` per-request timeout, a `12s` overall backend scan deadline (with a 45s in-memory cache), and a `15s` client timeout with live elapsed progress and retry controls.
- **Complete History Counters + Recent Sample:** Combines `/counters` for lifetime transaction and token transfer counts across all 10 networks with bounded recent transaction sampling (`25` per chain) so busy wallets load reliably in seconds.
- **Direct Blockscout Explorer Verification:** Every risk signal, address poisoning lookalike, token approval, spender contract, asset, counterparty, and transaction links directly to its exact record on the corresponding chain's Blockscout Explorer.

## Product

Investigate any EVM address across 10 networks in parallel:
1. **Portfolio & Asset Allocation:** Native and ERC-20 token holdings with USD valuation and allocation chart.
2. **Risk Signals & Poisoning Detection:** Automated vanity lookalike (prefix + suffix match) detection, zero-value transfer spoofing alerts, and ERC-20/NFT approval inspection.
3. **Wallet Linkability Score (0–100):** Evaluates cross-chain address reuse, shared counterparties across 2+ networks, and overlapping UTC activity windows.
4. **Historical Performance & Activity Charts:** Cumulative/daily USD transaction volume area chart and daily multichain transaction frequency bar chart alongside lifetime transaction counters.
5. **Public Identity & Verification:** ENS, contract labels, public tags, and 1-click links to Blockscout Explorer for every on-chain artifact.

## Gotchas

- Balance and volume USD estimates depend on exchange rates returned by Blockscout; missing prices are surfaced transparently via partial-data notices rather than fabricated.
- Transaction-derived risk signals inspect the bounded recent transaction sample per chain (`25` txs/chain) alongside lifetime `/counters` totals, and serve as verifiable analyst prompts with direct Blockscout links.