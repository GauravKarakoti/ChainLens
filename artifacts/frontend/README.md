# ChainLens

ChainLens is a read-only multichain wallet investigation dashboard. It retrieves live public chain records across **10 EVM networks** in parallel using Blockscout v2 (with optional Blockscout PRO acceleration), computes a **Wallet Linkability Score**, renders **historical performance and activity charts**, and links every finding directly to **Blockscout Explorer** for independent on-chain verification.

## Configure the Blockscout API

- **Zero-Config Public Mode (Default):** ChainLens works out of the box using official public Blockscout v2 endpoints (`https://{network}.blockscout.com/api/v2`) so the live demo is always available even without an API key.
- **Optional Blockscout PRO Acceleration:** Add `BLOCKSCOUT_PRO_API_KEY` to the API Server's Env Secrets (`artifacts/api-server/.env`). The key is read by the server only and is never exposed to the browser. If a PRO endpoint is rate-limited or returns `HTTP 402`, the server automatically falls back to the chain's public Blockscout v2 instance.
- **Bounded Timeouts & Reliability:** Upstream requests enforce a `6s` per-request timeout and a `12s` overall backend deadline (with a `45s` TTL cache). The frontend enforces a `15s` client time limit with a live elapsed timer and one-click retry state.

## Supported networks (10 EVM chains)

| Network | Chain ID | Blockscout Explorer |
| --- | ---: | --- |
| Ethereum | 1 | `https://eth.blockscout.com` |
| Optimism | 10 | `https://optimism.blockscout.com` |
| Arbitrum | 42161 | `https://arbitrum.blockscout.com` |
| Base | 8453 | `https://base.blockscout.com` |
| Polygon | 137 | `https://polygon.blockscout.com` |
| Gnosis | 100 | `https://gnosis.blockscout.com` |
| zkSync Era | 324 | `https://zksync.blockscout.com` |
| Scroll | 534352 | `https://scroll.blockscout.com` |
| Linea | 59144 | `https://linea.blockscout.com` |
| Celo | 42220 | `https://celo.blockscout.com` |

## Data sources by feature

The web app calls the shared API server; the server queries all 10 Blockscout networks concurrently via `Promise.allSettled`.

| ChainLens feature | ChainLens API | Blockscout source |
| --- | --- | --- |
| Connection status | `GET /api/blockscout/status` | Confirms multi-chain Blockscout availability (PRO + public v2 fallback) without disclosing secrets. |
| Native balances & coin prices | `GET /api/wallets/{address}/overview` | `GET /api/v2/addresses/{address}` (`coin_balance` and `exchange_rate`), with fallback to `GET /api/v2/stats` (`coin_price`). |
| Complete lifetime history counters | `GET /api/wallets/{address}/overview` | `GET /api/v2/addresses/{address}/counters` supplies lifetime `transactions_count` and `token_transfers_count` per chain. |
| Token balances & USD estimates | `GET /api/wallets/{address}/overview` | `GET /api/v2/addresses/{address}/token-balances` (capped at top 30 ERC-20 positions per chain); USD estimates use returned token `exchange_rate`. |
| Recent activity (bounded sample) | `GET /api/wallets/{address}/overview` | `GET /api/v2/addresses/{address}/transactions` (capped at the 25 most recent transactions per chain for fast loading on busy wallets). |
| Approval detection & allowance parsing | `GET /api/wallets/{address}/overview` | Parses `decoded_input` and raw hex calldata (`raw_input`) directly from returned transactions (`approve`, `increaseAllowance`, `setApprovalForAll`) without extra per-transaction `/logs` HTTP calls. |
| Wallet Linkability Score & shared counterparties | `GET /api/wallets/{address}/overview` | Computed from multi-chain address reuse, shared counterparties across 2+ networks, and overlapping UTC activity windows. |
| Historical performance & activity charts | `GET /api/wallets/{address}/overview` | Aggregates returned multichain transactions by date into cumulative/daily USD volume (`AreaChart`) and daily transaction frequency (`BarChart`). |
| Address name, ENS name, website, tags, and icon | `GET /api/addresses/{address}/metadata` | `GET https://api.blockscout.com/services/metadata/api/v1/metadata?addresses={address}` with automatic fallback to `GET https://eth.blockscout.com/api/v2/addresses/{address}`. |

The portfolio total and Recharts allocation pie chart use only values for which Blockscout returned a price. Missing prices are never fabricated. The fungible token table includes ERC-20 balances; rows without valid decimals or balances are omitted with a partial-data notice. Lifetime transaction totals are fetched via `/counters`, while detailed transaction tables, charts, and forensic heuristics operate on the bounded recent transaction sample (`25` per chain).

## Forensics, risk signals & Blockscout verification

Every risk signal, approval, spender contract, token, counterparty, and transaction row includes a direct deep link (`/tx/{hash}`, `/address/{address}`, or `/token/{address}`) to the corresponding chain's **Blockscout Explorer** so analysts can verify findings firsthand:

- **Address poisoning & lookalike activity:** Compares transaction senders and recipients against known counterparties and the wallet's own address. A vanity lookalike match is flagged when two distinct addresses share at least 4 leading and 4 trailing hexadecimal characters (with `prefix + suffix >= 8`) or `>= 6` leading/trailing characters, especially on zero-value transfers.
- **Token approval detection:** Inspects transaction `decoded_input` parameters and `raw_input` selectors (`0x095ea7b3`, `0x39509351`, `0xa22cb465`) in memory, extracting the spender contract address and classifying the allowance as `Unlimited (MAX)`, `Bounded allowance`, or `Revoked (0)`.
- **Wallet Linkability Score (`0–100`):** Quantifies cross-chain clustering exposure across active network count, shared counterparties seen on 2+ EVM chains, and overlapping UTC activity hours.

## Development & testing

From the workspace root:

```sh
# Start API server and frontend in development mode
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/frontend run dev

# Run unit tests for address poisoning, approval detection, and linkability scoring
pnpm --filter @workspace/api-server exec tsx --test src/lib/__tests__/blockscout.test.ts

# Regenerate Orval React Query hooks and Zod schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Typecheck and build all packages
pnpm run typecheck
pnpm run build
```