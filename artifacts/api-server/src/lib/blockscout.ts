import type {
  AddressMetadata,
  ChainWallet,
  TokenBalance,
  WalletTransaction,
} from "@workspace/api-zod";

const PRO_REST_BASE = "https://api.blockscout.com";
const METADATA_BASE = "https://api.blockscout.com/services/metadata/api/v1";

const CHAINS = [
  { chainId: 1, chainName: "Ethereum", nativeSymbol: "ETH" },
  { chainId: 8453, chainName: "Base", nativeSymbol: "ETH" },
  { chainId: 10, chainName: "Optimism", nativeSymbol: "ETH" },
  { chainId: 42161, chainName: "Arbitrum", nativeSymbol: "ETH" },
] as const;

type JsonObject = Record<string, unknown>;

let upstreamQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

function scheduleUpstreamRequest<T>(request: () => Promise<T>): Promise<T> {
  const result = upstreamQueue.then(async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    nextRequestAt = Date.now() + 250;
    return request();
  });
  upstreamQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function objectOf(value: unknown): JsonObject {
  return value !== null && typeof value === "object"
    ? (value as JsonObject)
    : {};
}

function stringOf(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function addressOf(value: unknown): string {
  if (typeof value === "string") return value;
  return stringOf(objectOf(value).hash);
}

function formatUnits(value: unknown, decimals: number): string {
  const raw = typeof value === "string" ? value : String(value ?? "0");
  if (!/^-?\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0) {
    return "0";
  }
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (decimals === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function urlWithKey(url: URL, apiKey: string): URL {
  url.searchParams.set("apikey", apiKey);
  return url;
}

async function readJson(url: URL, description: string): Promise<unknown> {
  const apiKey = url.searchParams.get("apikey");
  const response = await scheduleUpstreamRequest(() =>
    fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(15_000),
    }),
  );
  if (!response.ok) {
    const remainingCredits = response.headers.get("x-credits-remaining");
    const creditCount =
      remainingCredits && /^\d+$/.test(remainingCredits)
        ? remainingCredits
        : "unreported";
    const paymentChallenge = response.headers.has("payment-required")
      ? "present"
      : "absent";
    const paymentDetails =
      response.status === 402
        ? ` (credits remaining: ${creditCount}; payment challenge: ${paymentChallenge})`
        : "";
    throw new Error(
      `${description} returned HTTP ${response.status}${paymentDetails}`,
    );
  }
  return response.json() as Promise<unknown>;
}

function requireApiKey(): string {
  const key = process.env.BLOCKSCOUT_PRO_API_KEY;
  if (!key) {
    const error = new Error("Blockscout PRO API key is not configured");
    error.name = "BlockscoutKeyMissingError";
    throw error;
  }
  return key;
}

export function isBlockscoutConfigured(): boolean {
  return Boolean(process.env.BLOCKSCOUT_PRO_API_KEY);
}

export async function getNativeBalance(
  address: string,
  chainId: number,
): Promise<string | null> {
  const apiKey = requireApiKey();
  const data = objectOf(
    await readJson(
      chainRestUrl(
        chainId,
        `addresses/${encodeURIComponent(address)}`,
        apiKey,
      ),
      "Native balance request",
    ),
  );
  const result = data.coin_balance;
  if (result === null || result === undefined) return null;
  if (typeof result !== "string" && typeof result !== "number") {
    throw new Error("Blockscout returned an unexpected native balance response");
  }
  return formatUnits(result, 18);
}

function chainRestUrl(chainId: number, endpoint: string, apiKey: string): URL {
  return urlWithKey(
    new URL(`${PRO_REST_BASE}/${chainId}/api/v2/${endpoint}`),
    apiKey,
  );
}

export async function getTokenBalances(
  address: string,
  chainId: number,
): Promise<{ tokens: TokenBalance[]; incomplete: boolean }> {
  const apiKey = requireApiKey();
  const data = await readJson(
    chainRestUrl(
      chainId,
      `addresses/${encodeURIComponent(address)}/token-balances`,
      apiKey,
    ),
    "Token balances request",
  );
  if (!Array.isArray(data)) {
    throw new Error("Blockscout returned an unexpected token balances response");
  }
  const items = data;
  let incomplete = false;
  const tokens = items.flatMap((entry): TokenBalance[] => {
    const row = objectOf(entry);
    const token = objectOf(row.token);
    const tokenType = stringOf(token.type).toUpperCase();
    if (tokenType && tokenType !== "ERC-20") return [];
    const parsedDecimals = numberOf(token.decimals);
    if (parsedDecimals === null || parsedDecimals < 0) {
      incomplete = true;
      return [];
    }
    const decimals = Math.trunc(parsedDecimals);
    const rawBalance = row.value ?? row.token_balance ?? row.balance;
    if (rawBalance === undefined || rawBalance === null) {
      incomplete = true;
      return [];
    }
    const balance = formatUnits(rawBalance, decimals);
    const priceUsd = numberOf(token.exchange_rate);
    const balanceNumber = Number(balance);
    return [{
      address: stringOf(token.address_hash ?? token.address),
      name: stringOf(token.name, "Unknown token"),
      symbol: stringOf(token.symbol, "—"),
      decimals,
      balance,
      priceUsd,
      valueUsd:
        priceUsd !== null && Number.isFinite(balanceNumber)
          ? balanceNumber * priceUsd
          : null,
      iconUrl:
        typeof token.icon_url === "string" && token.icon_url.length > 0
          ? token.icon_url
          : null,
    }];
  });
  return { tokens, incomplete };
}

function normalizeTransaction(entry: unknown): WalletTransaction | null {
  const row = objectOf(entry);
  const timestampValue = row.timestamp ?? row.created_at;
  const timestamp = new Date(
    typeof timestampValue === "string" || typeof timestampValue === "number"
      ? timestampValue
      : "",
  );
  if (!Number.isFinite(timestamp.getTime())) return null;

  const status = stringOf(
    row.status,
    row.is_error === true ? "failed" : "success",
  );
  return {
    hash: stringOf(row.hash),
    timestamp,
    from: addressOf(row.from),
    to: addressOf(row.to) || null,
    value: stringOf(row.value, "0"),
    method:
      stringOf(row.method) ||
      stringOf(objectOf(row.decoded_input).method_call) ||
      null,
    status,
  };
}

function isApprovalCandidate(row: JsonObject): boolean {
  const decodedMethod = stringOf(
    objectOf(row.decoded_input).method_call,
  ).toLowerCase();
  const method = stringOf(row.method).toLowerCase();
  const input = stringOf(row.raw_input ?? row.input).toLowerCase();
  return (
    method.includes("approve") ||
    decodedMethod.includes("approve") ||
    input.startsWith("0x095ea7b3") ||
    input.startsWith("0xa22cb465")
  );
}

async function hasApprovalEvent(
  transaction: WalletTransaction,
  chainId: number,
  apiKey: string,
): Promise<boolean> {
  const logs = objectOf(
    await readJson(
      chainRestUrl(
        chainId,
        `transactions/${encodeURIComponent(transaction.hash)}/logs`,
        apiKey,
      ),
      "Transaction logs request",
    ),
  );
  const items = Array.isArray(logs.items) ? logs.items : [];
  return items.some((entry) => {
    const row = objectOf(entry);
    const decoded = stringOf(objectOf(row.decoded).method_call).toLowerCase();
    return decoded.includes("approval(");
  });
}

export async function getTransactions(
  address: string,
  chainId: number,
): Promise<WalletTransaction[]> {
  const apiKey = requireApiKey();
  const data = objectOf(
    await readJson(
      chainRestUrl(
        chainId,
        `addresses/${encodeURIComponent(address)}/transactions`,
        apiKey,
      ),
      "Transaction history request",
    ),
  );
  if (!Array.isArray(data.items)) {
    throw new Error("Blockscout returned an unexpected transaction history response");
  }
  const items = data.items;
  const transactions = items
    .map((entry) => ({
      entry: objectOf(entry),
      transaction: normalizeTransaction(entry),
    }))
    .filter(
      (
        item,
      ): item is { entry: JsonObject; transaction: WalletTransaction } =>
        Boolean(item.transaction?.hash && item.transaction.from),
    );

  return Promise.all(
    transactions.map(async ({ entry, transaction }) => {
      if (!isApprovalCandidate(entry)) return transaction;
      if (!(await hasApprovalEvent(transaction, chainId, apiKey))) {
        return transaction;
      }
      return {
        ...transaction,
        method: `Approval event detected · ${transaction.method ?? "token approval"}`,
      };
    }),
  );
}

async function getNativeTokenPrice(chainId: number): Promise<number | null> {
  const apiKey = requireApiKey();
  const data = objectOf(
    await readJson(chainRestUrl(chainId, "stats", apiKey), "Chain stats request"),
  );
  return numberOf(data.coin_price);
}

function nativeRequestStatus(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return error.message.match(/HTTP (\d{3})/)?.[1] ?? null;
}

async function getChainWallet(
  address: string,
  chain: (typeof CHAINS)[number],
): Promise<ChainWallet> {
  const [nativeBalance, tokenResult, transactions, nativePriceUsd] =
    await Promise.all([
      getNativeBalance(address, chain.chainId).catch((error) => {
        console.warn("Blockscout native balance unavailable", {
          chainId: chain.chainId,
          httpStatus: nativeRequestStatus(error),
        });
        return null;
      }),
      getTokenBalances(address, chain.chainId),
      getTransactions(address, chain.chainId),
      getNativeTokenPrice(chain.chainId).catch(() => null),
    ]);
  return {
    ...chain,
    nativeBalance,
    nativePriceUsd,
    tokens: tokenResult.tokens,
    tokenBalancesIncomplete: tokenResult.incomplete,
    transactions,
  };
}

export async function getWalletOverview(address: string) {
  requireApiKey();
  const chains = await Promise.all(
    CHAINS.map((chain) => getChainWallet(address, chain)),
  );
  return { address, chains };
}

function collectStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const row = objectOf(item);
    const label = row.name ?? row.label ?? row.display_name;
    return typeof label === "string" ? [label] : [];
  });
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

export async function getAddressMetadata(
  address: string,
): Promise<AddressMetadata> {
  const apiKey = requireApiKey();
  const url = urlWithKey(new URL(`${METADATA_BASE}/metadata`), apiKey);
  url.searchParams.set("addresses", address);
  const response = await readJson(url, "Address metadata request");
  const result = objectOf(response);
  const addressRecords = objectOf(result.addresses);
  const raw = objectOf(
    (Array.isArray(response)
      ? response.find((entry) => {
          const row = objectOf(entry);
          return addressOf(row.address ?? row.hash).toLowerCase() === address.toLowerCase();
        })
      : addressRecords[address] ??
        addressRecords[address.toLowerCase()] ??
        result[address] ??
        response),
  );
  const metadata = objectOf(raw.metadata);
  const tags = [
    ...collectStrings(raw.tags),
    ...collectStrings(raw.public_tags),
    ...collectStrings(metadata.tags),
    ...collectStrings(metadata.public_tags),
  ];
  const name = firstString(raw.name, raw.label, metadata.name, metadata.label);
  const ensName = firstString(
    raw.ens_name,
    raw.ensName,
    raw.ens_domain_name,
    metadata.ens_name,
    metadata.ens_domain_name,
  );
  const website = firstString(raw.website, metadata.website, raw.url);
  const iconUrl = firstString(
    raw.icon_url,
    raw.iconUrl,
    raw.image_url,
    metadata.icon_url,
  );
  return {
    address,
    name,
    ensName,
    website,
    tags: [...new Set(tags)],
    iconUrl,
    hasMetadata: Boolean(name || ensName || website || iconUrl || tags.length),
  };
}
