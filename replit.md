# ChainLens

Read-only multichain wallet research using live Blockscout public chain data.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/chainlens run dev` — run the ChainLens web app
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the API server
- `pnpm --filter @workspace/chainlens run typecheck` — typecheck the ChainLens app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required secret: `BLOCKSCOUT_PRO_API_KEY` — configure through Replit Secrets; used only by the API server

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React, Vite, Tailwind CSS, Recharts
- API: Express 5
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/chainlens/` — ChainLens dashboard and its feature/data-source README
- `artifacts/api-server/src/lib/blockscout.ts` — server-side Blockscout requests and normalization
- `artifacts/api-server/src/routes/chainlens.ts` — ChainLens API routes
- `lib/api-spec/openapi.yaml` — source-of-truth API contract; generated client and Zod types live in `lib/api-client-react/` and `lib/api-zod/`

## Architecture decisions

- Blockscout calls and the API key stay on the server; the browser calls the shared API server.
- ChainLens uses live responses only and renders explicit unconfigured, error, empty, and partial-data states rather than substituting sample data.
- Wallet overview covers Ethereum (1), Base (8453), Optimism (10), and Arbitrum (42161).

## Product

Investigate an EVM address across four networks, review balances and recent transactions, see priced asset allocation, inspect public address metadata, and review transaction-derived risk signals.

## User preferences

No additional standing preferences recorded.

## Gotchas

- Balance estimates depend on prices returned by Blockscout; missing prices are not filled with estimates.
- Transaction-derived signals only cover the history returned by Blockscout and are review prompts, not security conclusions.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
