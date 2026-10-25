import type {
  AddressMetadata,
  ChainWallet,
  TokenBalance,
  WalletTransaction,
} from "@workspace/api-zod";
import "dotenv/config";

const PRO_REST_BASE = "https://api.blockscout.com";
const METADATA_BASE = "https://api.blockscout.com/services/metadata/api/v1";

export const CHAINS = [
  {
    chainId: 1,
    chainName: "Ethereum",
    nativeSymbol: "ETH",
    explorerUrl: "https://eth.blockscout.com",
    publicApiBase: "https://eth.blockscout.com/api/v2",
  },
  {
    chainId: 10,
    chainName: "Optimism",
    nativeSymbol: "ETH",
    explorerUrl: "https://optimism.blockscout.com",
    publicApiBase: "https://optimism.blockscout.com/api/v2",
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    nativeSymbol: "ETH",
    explorerUrl: "https://arbitrum.blockscout.com",
    publicApiBase: "https://arbitrum.blockscout.com/api/v2",
  },
  {
    chainId: 8453,
    chainName: "Base",
    nativeSymbol: "ETH",
    explorerUrl: "https://base.blockscout.com",
    publicApiBase: "https://base.blockscout.com/api/v2",
  },
  {
    chainId: 137,
    chainName: "Polygon",
    nativeSymbol: "POL",
    explorerUrl: "https://polygon.blockscout.com",
    publicApiBase: "https://polygon.blockscout.com/api/v2",
  },
  {
    chainId: 100,
    chainName: "Gnosis",
    nativeSymbol: "xDAI",
    explorerUrl: "https://gnosis.blockscout.com",
    publicApiBase: "https://gnosis.blockscout.com/api/v2",
  },
  {
    chainId: 324,
    chainName: "zkSync Era",
    nativeSymbol: "ETH",
    explorerUrl: "https://zksync.blockscout.com",
    publicApiBase: "https://zksync.blockscout.com/api/v2",
  },
  {
    chainId: 534352,
    chainName: "Scroll",
    nativeSymbol: "ETH",
    explorerUrl: "https://scroll.blockscout.com",
    publicApiBase: "https://scroll.blockscout.com/api/v2",
  },
  {
    chainId: 59144,
    chainName: "Linea",
    nativeSymbol: "ETH",
    explorerUrl: "https://linea.blockscout.com",
    publicApiBase: "https://linea.blockscout.com/api/v2",
  },
  {
    chainId: 42220,
    chainName: "Celo",
    nativeSymbol: "CELO",
    explorerUrl: "https://celo.blockscout.com",
    publicApiBase: "https://celo.blockscout.com/api/v2",
  },
] as const;

export type SupportedChain = (typeof CHAINS)[number];
type JsonObject = Record<string, unknown>;

const PER_REQUEST_TIMEOUT_MS = 6_000;
const OVERALL_OVERVIEW_TIMEOUT_MS = 12_000;
const MAX_TX_PER_CHAIN = 25;
const MAX_TOKENS_PER_CHAIN = 30;
const CACHE_TTL_MS = 45_000;

export interface ApprovalFinding {
  chainId: number;
  chainName: string;
  hash: string;
  timestamp: string;
  tokenAddress: string;
  spenderAddress: string;
  allowanceType: "unlimited" | "bounded" | "revoked";
  formattedAllowance: string;
  method: string;
  txExplorerUrl: string;
  tokenExplorerUrl: string;
  spenderExplorerUrl: string;
}

export interface PoisoningFinding {
  chainId: number;
  chainName: string;
  hash: string;
  timestamp: string;
  suspiciousAddress: string;
  mimickedAddress: string;
  prefixMatch: number;
  suffixMatch: number;
  isZeroValue: boolean;
  txExplorerUrl: string;
  suspiciousExplorerUrl: string;
  mimickedExplorerUrl: string;
}

export interface LinkabilitySummary {
  score: number;
  level: "Low" | "Moderate" | "High" | "Critical";
  activeChainCount: number;
  sharedCounterpartyCount: number;
  temporalOverlapCount: number;
  hasPublicIdentity: boolean;
  sharedCounterparties: Array<{
    address: string;
    chains: string[];
    txCount: number;
    explorerUrl: string;
  }>;
}

export interface HistoricalPoint {
  date: string;
  txCount: number;
  volumeUsd: number;
  cumulativeVolumeUsd: number;
  activeChains: number;
}

export interface EnrichedChainWallet extends ChainWallet {
  explorerUrl: string;
  addressExplorerUrl: string;
  totalTransactionsCount: number;
  totalTokenTransfersCount: number;
}

export interface EnrichedWalletOverview {
  address: string;
  chains: EnrichedChainWallet[];
  totalLifetimeTransactions: number;
  totalLifetimeTokenTransfers: number;
  approvals: ApprovalFinding[];
  poisoningMatches: PoisoningFinding[];
  linkability: LinkabilitySummary;
  history: HistoricalPoint[];
}

const overviewCache = new Map<
  string,
  { expiresAt: number; data: EnrichedWalletOverview }
>();

export function getChainById(chainId: number): SupportedChain {
  return CHAINS.find((c) => c.chainId === chainId) ?? CHAINS[0];
}

export function getExplorerUrl(
  chainIdOrName: number | string,
  type: "tx" | "address" | "token",
  hashOrAddress: string,
): string {
  const chain =
    typeof chainIdOrName === "number"
      ? CHAINS.find((c) => c.chainId === chainIdOrName)
      : CHAINS.find(
          (c) => c.chainName.toLowerCase() === String(chainIdOrName).toLowerCase(),
        );
  const base = (chain?.explorerUrl ?? "https://eth.blockscout.com").replace(
    /\/+$/,
    "",
  );
  return `${base}/${type}/${hashOrAddress}`;
}

export function objectOf(value: unknown): JsonObject {
  return value !== null && typeof value === "object"
    ? (value as JsonObject)
    : {};
}

export function stringOf(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function addressOf(value: unknown): string {
  if (typeof value === "string") return value;
  return stringOf(objectOf(value).hash);
}

export function formatUnits(value: unknown, decimals: number): string {
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

function urlWithKey(url: URL, apiKey?: string): URL {
  if (apiKey) {
    url.searchParams.set("apikey", apiKey);
  }
  return url;
}

function publicChainRestUrl(chainId: number, endpoint: string): URL {
  const chain = getChainById(chainId);
  return new URL(`${chain.publicApiBase}/${endpoint.replace(/^\/+/, "")}`);
}

function proChainRestUrl(chainId: number, endpoint: string, apiKey: string): URL {
  return urlWithKey(
    new URL(`${PRO_REST_BASE}/${chainId}/api/v2/${endpoint.replace(/^\/+/, "")}`),
    apiKey,
  );
}

async function fetchJsonWithTimeout(
  url: URL,
  timeoutMs = PER_REQUEST_TIMEOUT_MS,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
  const apiKey = url.searchParams.get("apikey");

  return fetch(url, {
    headers: {
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    signal,
  });
}

async function readChainJson(
  chainId: number,
  endpoint: string,
  description: string,
  parentSignal?: AbortSignal,
): Promise<unknown> {
  const apiKey = process.env.BLOCKSCOUT_PRO_API_KEY?.trim();

  // 1. Try Public Blockscout v2 directly first when no PRO key is set,
  // or fallback automatically to Public Blockscout v2 if PRO endpoint fails/402s.
  if (apiKey) {
    try {
      const proUrl = proChainRestUrl(chainId, endpoint, apiKey);
      const proRes = await fetchJsonWithTimeout(
        proUrl,
        PER_REQUEST_TIMEOUT_MS,
        parentSignal,
      );
      if (proRes.ok) {
        return await proRes.json();
      }
    } catch {
      // Fall through to public Blockscout v2 instance
    }
  }

  const pubUrl = publicChainRestUrl(chainId, endpoint);
  const response = await fetchJsonWithTimeout(
    pubUrl,
    PER_REQUEST_TIMEOUT_MS,
    parentSignal,
  );
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

/**
 * Returns true because ChainLens automatically uses public Blockscout v2 instances
 * when BLOCKSCOUT_PRO_API_KEY is not set or exhausted.
 */
export function isBlockscoutConfigured(): boolean {
  return true;
}

export async function getAddressSummaryAndCounters(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<{
  nativeBalance: string | null;
  nativePriceUsd: number | null;
  totalTransactionsCount: number;
  totalTokenTransfersCount: number;
}> {
  const encoded = encodeURIComponent(address);
  const [addressData, countersData] = await Promise.all([
    readChainJson(
      chainId,
      `addresses/${encoded}`,
      "Native balance request",
      signal,
    ).catch(() => null),
    readChainJson(
      chainId,
      `addresses/${encoded}/counters`,
      "Address counters request",
      signal,
    ).catch(() => null),
  ]);

  const addrObj = objectOf(addressData);
  const rawBalance = addrObj.coin_balance;
  const nativeBalance =
    rawBalance !== null &&
    rawBalance !== undefined &&
    (typeof rawBalance === "string" || typeof rawBalance === "number")
      ? formatUnits(rawBalance, 18)
      : null;

  let nativePriceUsd = numberOf(addrObj.exchange_rate);
  if (nativePriceUsd === null && addressData !== null) {
    const statsObj = objectOf(
      await readChainJson(chainId, "stats", "Chain stats request", signal).catch(
        () => null,
      ),
    );
    nativePriceUsd = numberOf(statsObj.coin_price);
  }

  const countersObj = objectOf(countersData);
  const totalTransactionsCount =
    numberOf(countersObj.transactions_count) ?? 0;
  const totalTokenTransfersCount =
    numberOf(countersObj.token_transfers_count) ?? 0;

  return {
    nativeBalance,
    nativePriceUsd,
    totalTransactionsCount,
    totalTokenTransfersCount,
  };
}

export async function getNativeBalance(
  address: string,
  chainId: number,
): Promise<string | null> {
  const data = objectOf(
    await readChainJson(
      chainId,
      `addresses/${encodeURIComponent(address)}`,
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

export async function getTokenBalances(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<{ tokens: TokenBalance[]; incomplete: boolean }> {
  const data = await readChainJson(
    chainId,
    `addresses/${encodeURIComponent(address)}/token-balances`,
    "Token balances request",
    signal,
  );
  if (!Array.isArray(data)) {
    throw new Error("Blockscout returned an unexpected token balances response");
  }
  let incomplete = data.length > MAX_TOKENS_PER_CHAIN;
  const items = data.slice(0, MAX_TOKENS_PER_CHAIN);
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
    return [
      {
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
      },
    ];
  });
  return { tokens, incomplete };
}

export function normalizeTransaction(entry: unknown): WalletTransaction | null {
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

export function isApprovalCandidate(row: JsonObject): boolean {
  const decodedMethod = stringOf(
    objectOf(row.decoded_input).method_call,
  ).toLowerCase();
  const method = stringOf(row.method).toLowerCase();
  const input = stringOf(row.raw_input ?? row.input).toLowerCase();
  return (
    method.includes("approve") ||
    method.includes("increaseallowance") ||
    method.includes("setapprovalforall") ||
    decodedMethod.includes("approve") ||
    decodedMethod.includes("increaseallowance") ||
    decodedMethod.includes("setapprovalforall") ||
    input.startsWith("0x095ea7b3") ||
    input.startsWith("0x39509351") ||
    input.startsWith("0xa22cb465")
  );
}

const UNLIMITED_UINT256_THRESHOLD = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000",
);

export function parseApprovalDetails(row: JsonObject): {
  isApproval: boolean;
  spenderAddress: string | null;
  allowanceType: "unlimited" | "bounded" | "revoked";
  formattedAllowance: string;
  baseMethod: string;
} | null {
  if (!isApprovalCandidate(row)) return null;

  const status = stringOf(row.status, row.is_error === true ? "failed" : "ok").toLowerCase();
  if (status === "error" || status === "failed" || status === "reverted") {
    return null;
  }

  const decodedInput = objectOf(row.decoded_input);
  const methodCall = stringOf(decodedInput.method_call);
  const rawMethod = stringOf(row.method) || methodCall.split("(")[0] || "approve";
  const rawInput = stringOf(row.raw_input ?? row.input).toLowerCase();

  let spenderAddress: string | null = null;
  let amountBigInt: bigint | null = null;
  let approvalBool: boolean | null = null;

  const params = Array.isArray(decodedInput.parameters)
    ? decodedInput.parameters
    : [];

  for (const param of params) {
    const p = objectOf(param);
    const pType = stringOf(p.type).toLowerCase();
    const pName = stringOf(p.name).toLowerCase();
    const pVal = p.value;

    if (
      !spenderAddress &&
      (pType === "address" || /spender|operator|usr|guy/.test(pName)) &&
      typeof pVal === "string" &&
      /^0x[a-fA-F0-9]{40}$/.test(pVal)
    ) {
      spenderAddress = pVal;
    } else if (pType === "bool" || typeof pVal === "boolean") {
      approvalBool =
        pVal === true ||
        String(pVal).toLowerCase() === "true" ||
        String(pVal) === "1";
    } else if (pType.startsWith("uint") && pVal !== undefined && pVal !== null) {
      try {
        amountBigInt = BigInt(String(pVal));
      } catch {
        amountBigInt = null;
      }
    }
  }

  // Fallback to decoding raw 68-byte ERC-20 approve(address,uint256) / setApprovalForAll calldata
  if (
    (!spenderAddress || (amountBigInt === null && approvalBool === null)) &&
    rawInput.startsWith("0x") &&
    rawInput.length >= 138
  ) {
    const selector = rawInput.slice(0, 10);
    const word1 = rawInput.slice(10, 74);
    const word2 = rawInput.slice(74, 138);
    const candidateAddr = `0x${word1.slice(24)}`;
    if (!spenderAddress && /^0x[a-f0-9]{40}$/i.test(candidateAddr)) {
      spenderAddress = candidateAddr;
    }
    if (selector === "0xa22cb465") {
      try {
        approvalBool = BigInt(`0x${word2}`) !== 0n;
      } catch {
        approvalBool = false;
      }
    } else if (amountBigInt === null) {
      try {
        amountBigInt = BigInt(`0x${word2}`);
      } catch {
        amountBigInt = null;
      }
    }
  }

  let allowanceType: "unlimited" | "bounded" | "revoked" = "bounded";
  let formattedAllowance = "Bounded allowance";

  if (approvalBool !== null) {
    allowanceType = approvalBool ? "unlimited" : "revoked";
    formattedAllowance = approvalBool ? "Unlimited (All NFTs)" : "Revoked (0)";
  } else if (amountBigInt !== null) {
    if (amountBigInt === 0n) {
      allowanceType = "revoked";
      formattedAllowance = "Revoked (0)";
    } else if (amountBigInt >= UNLIMITED_UINT256_THRESHOLD) {
      allowanceType = "unlimited";
      formattedAllowance = "Unlimited (MAX)";
    } else {
      allowanceType = "bounded";
      formattedAllowance = `${formatUnits(amountBigInt.toString(), 18)}`;
    }
  }

  return {
    isApproval: true,
    spenderAddress,
    allowanceType,
    formattedAllowance,
    baseMethod: rawMethod,
  };
}

export async function getTransactions(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<WalletTransaction[]> {
  const data = objectOf(
    await readChainJson(
      chainId,
      `addresses/${encodeURIComponent(address)}/transactions`,
      "Transaction history request",
      signal,
    ),
  );
  if (!Array.isArray(data.items)) {
    throw new Error(
      "Blockscout returned an unexpected transaction history response",
    );
  }
  const items = data.items.slice(0, MAX_TX_PER_CHAIN);

  return items
    .map((entry) => {
      const row = objectOf(entry);
      const transaction = normalizeTransaction(entry);
      if (!transaction?.hash || !transaction.from) return null;

      const approval = parseApprovalDetails(row);
      if (!approval) return transaction;

      const spenderNote = approval.spenderAddress
        ? ` · Spender ${approval.spenderAddress}`
        : "";
      return {
        ...transaction,
        method: `Approval event detected · ${approval.baseMethod} (${approval.formattedAllowance})${spenderNote}`,
      };
    })
    .filter((tx): tx is WalletTransaction => tx !== null);
}

export function txIsZeroValue(value: string): boolean {
  if (/^0x0*$/i.test(value.trim())) return true;
  const n = Number(value);
  return Number.isFinite(n) && n === 0;
}

export function lookalikeAddress(
  candidate: string,
  other: string,
): { isMatch: boolean; prefix: number; suffix: number } {
  const a = candidate.trim().toLowerCase().replace(/^0x/, "");
  const b = other.trim().toLowerCase().replace(/^0x/, "");
  if (
    a.length !== 40 ||
    b.length !== 40 ||
    !/^[a-f0-9]{40}$/.test(a) ||
    !/^[a-f0-9]{40}$/.test(b) ||
    a === b
  ) {
    return { isMatch: false, prefix: 0, suffix: 0 };
  }
  let prefix = 0;
  let suffix = 0;
  while (prefix < a.length && a[prefix] === b[prefix]) prefix += 1;
  while (suffix < a.length && a[a.length - suffix - 1] === b[b.length - suffix - 1]) {
    suffix += 1;
  }
  // Matches standard vanity poisoning (e.g., >=4 prefix & >=4 suffix, or >=5 & >=5)
  const isMatch =
    (prefix >= 4 && suffix >= 4 && prefix + suffix >= 8) ||
    prefix >= 6 ||
    suffix >= 6;
  return { isMatch, prefix, suffix };
}

export function detectAddressPoisoning(
  walletAddress: string,
  chains: Array<{
    chainId: number;
    chainName: string;
    transactions: WalletTransaction[];
  }>,
): PoisoningFinding[] {
  const self = walletAddress.toLowerCase();
  const allTxs = chains.flatMap((c) =>
    c.transactions.map((tx) => ({
      ...tx,
      chainId: c.chainId,
      chainName: c.chainName,
    })),
  );

  // Collect all legitimate known addresses from non-zero transactions (plus wallet itself)
  const knownLegitAddresses = new Set<string>([self]);
  for (const tx of allTxs) {
    if (!txIsZeroValue(tx.value)) {
      if (tx.from) knownLegitAddresses.add(tx.from.toLowerCase());
      if (tx.to) knownLegitAddresses.add(tx.to.toLowerCase());
    }
  }
  // Also fallback to comparing against all historical addresses in the dataset
  for (const tx of allTxs) {
    if (tx.from) knownLegitAddresses.add(tx.from.toLowerCase());
    if (tx.to) knownLegitAddresses.add(tx.to.toLowerCase());
  }

  const findings: PoisoningFinding[] = [];
  const seenKeys = new Set<string>();

  for (const tx of allTxs) {
    const candidates = [tx.from, tx.to ?? ""].filter(
      (addr) => addr && addr.toLowerCase() !== self,
    );

    for (const candidate of candidates) {
      for (const known of knownLegitAddresses) {
        if (candidate.toLowerCase() === known.toLowerCase()) continue;
        const sim = lookalikeAddress(candidate, known);
        if (!sim.isMatch) continue;

        const key = `${tx.chainId}:${tx.hash}:${candidate.toLowerCase()}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        findings.push({
          chainId: tx.chainId,
          chainName: tx.chainName,
          hash: tx.hash,
          timestamp:
            tx.timestamp instanceof Date
              ? tx.timestamp.toISOString()
              : String(tx.timestamp),
          suspiciousAddress: candidate,
          mimickedAddress: known,
          prefixMatch: sim.prefix,
          suffixMatch: sim.suffix,
          isZeroValue: txIsZeroValue(tx.value),
          txExplorerUrl: getExplorerUrl(tx.chainId, "tx", tx.hash),
          suspiciousExplorerUrl: getExplorerUrl(
            tx.chainId,
            "address",
            candidate,
          ),
          mimickedExplorerUrl: getExplorerUrl(tx.chainId, "address", known),
        });
      }
    }
  }

  return findings;
}

export function detectApprovals(
  chains: Array<{
    chainId: number;
    chainName: string;
    transactions: WalletTransaction[];
  }>,
): ApprovalFinding[] {
  const results: ApprovalFinding[] = [];

  for (const chain of chains) {
    for (const tx of chain.transactions) {
      const method = tx.method ?? "";
      if (!/approval event detected|approve|setApprovalForAll|increaseAllowance/i.test(method)) {
        continue;
      }

      const spenderMatch = method.match(/Spender (0x[a-fA-F0-9]{40})/);
      const spenderAddress = spenderMatch?.[1] ?? tx.to ?? tx.from;
      const tokenAddress = tx.to ?? tx.from;

      let allowanceType: ApprovalFinding["allowanceType"] = "bounded";
      let formattedAllowance = "Bounded allowance";
      if (/Unlimited/i.test(method)) {
        allowanceType = "unlimited";
        formattedAllowance = "Unlimited (MAX)";
      } else if (/Revoked/i.test(method)) {
        allowanceType = "revoked";
        formattedAllowance = "Revoked (0)";
      }

      results.push({
        chainId: chain.chainId,
        chainName: chain.chainName,
        hash: tx.hash,
        timestamp:
          tx.timestamp instanceof Date
            ? tx.timestamp.toISOString()
            : String(tx.timestamp),
        tokenAddress,
        spenderAddress,
        allowanceType,
        formattedAllowance,
        method,
        txExplorerUrl: getExplorerUrl(chain.chainId, "tx", tx.hash),
        tokenExplorerUrl: getExplorerUrl(chain.chainId, "token", tokenAddress),
        spenderExplorerUrl: getExplorerUrl(
          chain.chainId,
          "address",
          spenderAddress,
        ),
      });
    }
  }

  return results;
}

export function computeWalletLinkability(
  walletAddress: string,
  chains: Array<{
    chainId: number;
    chainName: string;
    nativeBalance: string | null;
    tokens: TokenBalance[];
    transactions: WalletTransaction[];
  }>,
  hasPublicIdentity = false,
): LinkabilitySummary {
  const self = walletAddress.toLowerCase();
  const activeChains = chains.filter(
    (c) =>
      Number(c.nativeBalance ?? 0) > 0 ||
      c.tokens.length > 0 ||
      c.transactions.length > 0,
  );

  const counterpartyMap = new Map<
    string,
    { chains: Set<string>; firstChainId: number; txCount: number }
  >();
  const hourBuckets = new Map<number, Set<string>>();

  for (const chain of chains) {
    for (const tx of chain.transactions) {
      const from = tx.from.toLowerCase();
      const to = (tx.to ?? "").toLowerCase();
      const other = from === self ? to : from;

      if (/^0x[a-f0-9]{40}$/.test(other) && other !== self) {
        const entry = counterpartyMap.get(other) ?? {
          chains: new Set<string>(),
          firstChainId: chain.chainId,
          txCount: 0,
        };
        entry.chains.add(chain.chainName);
        entry.txCount += 1;
        counterpartyMap.set(other, entry);
      }

      const d = new Date(tx.timestamp);
      if (Number.isFinite(d.getTime())) {
        const hour = d.getUTCHours();
        const bucket = hourBuckets.get(hour) ?? new Set<string>();
        bucket.add(chain.chainName);
        hourBuckets.set(hour, bucket);
      }
    }
  }

  const sharedCounterparties = Array.from(counterpartyMap.entries())
    .filter(([, v]) => v.chains.size >= 2)
    .map(([address, v]) => ({
      address,
      chains: Array.from(v.chains),
      txCount: v.txCount,
      explorerUrl: getExplorerUrl(v.firstChainId, "address", address),
    }))
    .sort((a, b) => b.chains.length - a.chains.length || b.txCount - a.txCount);

  const temporalOverlapCount = Array.from(hourBuckets.values()).filter(
    (s) => s.size >= 2,
  ).length;

  const chainScore = Math.min(35, activeChains.length * 5);
  const counterpartyScore = Math.min(35, sharedCounterparties.length * 12);
  const temporalScore = Math.min(15, temporalOverlapCount * 3);
  const identityScore = hasPublicIdentity ? 15 : 0;

  const score = Math.min(
    100,
    chainScore + counterpartyScore + temporalScore + identityScore,
  );
  const level: LinkabilitySummary["level"] =
    score >= 75
      ? "Critical"
      : score >= 50
        ? "High"
        : score >= 25
          ? "Moderate"
          : "Low";

  return {
    score,
    level,
    activeChainCount: activeChains.length,
    sharedCounterpartyCount: sharedCounterparties.length,
    temporalOverlapCount,
    hasPublicIdentity,
    sharedCounterparties: sharedCounterparties.slice(0, 6),
  };
}

export function buildHistoricalPerformance(
  chains: Array<{
    chainId: number;
    chainName: string;
    nativePriceUsd: number | null;
    transactions: WalletTransaction[];
  }>,
): HistoricalPoint[] {
  const byDate = new Map<
    string,
    { txCount: number; volumeUsd: number; chains: Set<string> }
  >();

  for (const chain of chains) {
    const price = chain.nativePriceUsd ?? 0;
    for (const tx of chain.transactions) {
      const d = new Date(tx.timestamp);
      if (!Number.isFinite(d.getTime())) continue;
      const dateKey = d.toISOString().slice(0, 10);
      const bucket = byDate.get(dateKey) ?? {
        txCount: 0,
        volumeUsd: 0,
        chains: new Set<string>(),
      };
      bucket.txCount += 1;
      bucket.chains.add(chain.chainName);

      const rawVal = Number(formatUnits(tx.value, 18));
      const valNormalized = Number.isFinite(rawVal) ? rawVal : 0;
      bucket.volumeUsd += valNormalized * price;
      byDate.set(dateKey, bucket);
    }
  }

  const dates = Array.from(byDate.keys()).sort();
  let cumulativeVolumeUsd = 0;

  return dates.map((date) => {
    const item = byDate.get(date)!;
    cumulativeVolumeUsd += item.volumeUsd;
    return {
      date,
      txCount: item.txCount,
      volumeUsd: Number(item.volumeUsd.toFixed(2)),
      cumulativeVolumeUsd: Number(cumulativeVolumeUsd.toFixed(2)),
      activeChains: item.chains.size,
    };
  });
}

async function getChainWallet(
  address: string,
  chain: SupportedChain,
  signal?: AbortSignal,
): Promise<EnrichedChainWallet> {
  const [summary, tokenResult, transactions] = await Promise.all([
    getAddressSummaryAndCounters(address, chain.chainId, signal).catch(() => ({
      nativeBalance: null,
      nativePriceUsd: null,
      totalTransactionsCount: 0,
      totalTokenTransfersCount: 0,
    })),
    getTokenBalances(address, chain.chainId, signal).catch(() => ({
      tokens: [],
      incomplete: true,
    })),
    getTransactions(address, chain.chainId, signal).catch(() => []),
  ]);

  return {
    chainId: chain.chainId,
    chainName: chain.chainName,
    nativeSymbol: chain.nativeSymbol,
    nativeBalance: summary.nativeBalance,
    nativePriceUsd: summary.nativePriceUsd,
    tokens: tokenResult.tokens,
    tokenBalancesIncomplete: tokenResult.incomplete,
    transactions,
    explorerUrl: chain.explorerUrl,
    addressExplorerUrl: getExplorerUrl(chain.chainId, "address", address),
    totalTransactionsCount: Math.max(
      summary.totalTransactionsCount,
      transactions.length,
    ),
    totalTokenTransfersCount: summary.totalTokenTransfersCount,
  };
}

export async function getWalletOverview(
  address: string,
): Promise<EnrichedWalletOverview> {
  const cacheKey = address.trim().toLowerCase();
  const cached = overviewCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    OVERALL_OVERVIEW_TIMEOUT_MS,
  );

  try {
    const settled = await Promise.allSettled(
      CHAINS.map((chain) => getChainWallet(address, chain, controller.signal)),
    );

    const chains: EnrichedChainWallet[] = settled.map((result, idx) => {
      const chain = CHAINS[idx];
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        chainId: chain.chainId,
        chainName: chain.chainName,
        nativeSymbol: chain.nativeSymbol,
        nativeBalance: null,
        nativePriceUsd: null,
        tokens: [],
        tokenBalancesIncomplete: true,
        transactions: [],
        explorerUrl: chain.explorerUrl,
        addressExplorerUrl: getExplorerUrl(chain.chainId, "address", address),
        totalTransactionsCount: 0,
        totalTokenTransfersCount: 0,
      };
    });

    const totalLifetimeTransactions = chains.reduce(
      (sum, c) => sum + c.totalTransactionsCount,
      0,
    );
    const totalLifetimeTokenTransfers = chains.reduce(
      (sum, c) => sum + c.totalTokenTransfersCount,
      0,
    );
    const approvals = detectApprovals(chains);
    const poisoningMatches = detectAddressPoisoning(address, chains);
    const linkability = computeWalletLinkability(address, chains, false);
    const history = buildHistoricalPerformance(chains);

    const overview: EnrichedWalletOverview = {
      address,
      chains,
      totalLifetimeTransactions,
      totalLifetimeTokenTransfers,
      approvals,
      poisoningMatches,
      linkability,
      history,
    };

    overviewCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data: overview,
    });

    return overview;
  } finally {
    clearTimeout(timer);
  }
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
  const apiKey = process.env.BLOCKSCOUT_PRO_API_KEY?.trim();

  let response: unknown = null;
  if (apiKey) {
    try {
      const url = urlWithKey(new URL(`${METADATA_BASE}/metadata`), apiKey);
      url.searchParams.set("addresses", address);
      const res = await fetchJsonWithTimeout(url, PER_REQUEST_TIMEOUT_MS);
      if (res.ok) {
        response = await res.json();
      }
    } catch {
      response = null;
    }
  }

  // Fallback to Ethereum Blockscout v2 address endpoint for public tags, contract name, and ENS
  if (!response) {
    response = await readChainJson(
      1,
      `addresses/${encodeURIComponent(address)}`,
      "Address metadata request",
    );
  }

  const result = objectOf(response);
  const addressRecords = objectOf(result.addresses);
  const raw = objectOf(
    Array.isArray(response)
      ? response.find((entry) => {
          const row = objectOf(entry);
          return (
            addressOf(row.address ?? row.hash).toLowerCase() ===
            address.toLowerCase()
          );
        })
      : addressRecords[address] ??
          addressRecords[address.toLowerCase()] ??
          result[address] ??
          response,
  );
  const metadata = objectOf(raw.metadata);
  const tags = [
    ...collectStrings(raw.tags),
    ...collectStrings(raw.public_tags),
    ...collectStrings(metadata.tags),
    ...collectStrings(metadata.public_tags),
  ];
  if (raw.is_contract === true) tags.push("Contract");
  if (raw.is_verified === true) tags.push("Verified");

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