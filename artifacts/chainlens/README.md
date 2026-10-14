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
| Native balances | `GET /api/wallets/{address}/overview` | `GET https://api.blockscout.com/v2/api?chain_id={chainId}&module=account&action=balance&address={address}`. |
| Token balances and token USD estimates | `GET /api/wallets/{address}/overview` | `GET https://api.blockscout.com/{chainId}/api/v2/addresses/{address}/token-balances`; USD estimates use returned token exchange rates. |
| Native-asset USD estimates | `GET /api/wallets/{address}/overview` | `GET https://api.blockscout.com/{chainId}/api/v2/stats` supplies the native coin price when available. |
| Recent activity | `GET /api/wallets/{address}/overview` | `GET https://api.blockscout.com/{chainId}/api/v2/addresses/{address}/transactions`. |
| Approval review signals | `GET /api/wallets/{address}/overview` | For approval-like transactions, `GET https://api.blockscout.com/{chainId}/api/v2/transactions/{hash}/logs` is checked for a decoded `Approval(...)` event. |
| Address name, ENS name, website, tags, and icon | `GET /api/addresses/{address}/metadata` | `GET https://api.blockscout.com/services/metadata/api/v1/metadata?addresses={address}`. |

Blockscout PRO authentication is added by the server to each request using the `apikey` query parameter. The browser only calls the shared API server.

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
