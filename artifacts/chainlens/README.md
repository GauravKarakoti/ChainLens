# ChainLens

ChainLens is a read-only multichain wallet investigation dashboard. It retrieves live public chain records from Blockscout PRO for Ethereum, Base, Optimism, and Arbitrum. It does not use sample or fabricated wallet data.

## Configure the Blockscout API

Add `BLOCKSCOUT_PRO_API_KEY` to the API Server's Replit Secrets. The key is read by the server only and is never returned to the browser. If it is missing, ChainLens displays **API Key is not set** and does not request wallet data.

## Supported networks

| Network | Chain ID |
| --- | ---: |
| Ethereum | 1 |
| Base | 8453 |
| Optimism | 10 |
| Arbitrum | 42161 |

## Data sources by feature

The web app calls the shared API server; the server makes authenticated requests to Blockscout.

| ChainLens feature | ChainLens API | Blockscout source |
| --- | --- | --- |
| Connection status and missing-key state | `GET /api/blockscout/status` | Checks whether the server has `BLOCKSCOUT_PRO_API_KEY`; it does not disclose the key. |
| Native balances | `GET /api/wallets/{address}/overview` | PRO-compatible account balance request with the chain ID. |
| Token balances and token USD estimates | `GET /api/wallets/{address}/overview` | V2 address token balances; USD estimates use the token exchange rates returned by Blockscout. |
| Native-asset USD estimates | `GET /api/wallets/{address}/overview` | V2 chain statistics provide the native coin price. |
| Recent activity | `GET /api/wallets/{address}/overview` | V2 address transaction history on each supported network. |
| Approval review signals | `GET /api/wallets/{address}/overview` | For approval-like transactions, V2 transaction logs are checked for a decoded `Approval(...)` event. |
| Address name, ENS name, website, tags, and icon | `GET /api/addresses/{address}/metadata` | Blockscout metadata API. |

The portfolio total and Recharts pie chart use only values for which Blockscout returned a price. Missing prices are not invented. Transaction history and risk signals are limited to the history Blockscout returns for each request; the dashboard does not claim to scan a wallet's complete lifetime history.

## Risk signals

- **Zero-value lookalike activity:** reviews zero-value transactions and compares their sender/recipient addresses against different addresses found in the returned wallet history. A match requires at least five matching hexadecimal characters at both the beginning and end of the addresses (excluding `0x`). This heuristic may miss or incorrectly flag activity; it is not a security verdict.
- **Token approval logs:** an approval-like method or common approval selector makes a transaction eligible for a log lookup. ChainLens marks it for review only when a decoded log contains an `Approval(...)` event. This does not assess approval risk or guarantee detection of every approval mechanism.

## Development

From the workspace root:

```sh
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/chainlens run dev
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/chainlens run typecheck
```
