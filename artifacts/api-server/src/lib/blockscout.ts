import type {
  AddressMetadata,
  ChainWallet,
  TokenBalance,
} from "@workspace/api-zod";
import "dotenv/config";
import {
  type ApprovalFinding,
  type HistoricalDataPoint,
  type RiskSignal,
  type WalletLinkabilityReport,
  type WalletTransaction,
  buildExplorerAddressUrl,
  buildExplorerTokenUrl,
  buildExplorerTxUrl,
  buildHistoricalPerformance,
  calculateLinkabilityScore,
  detectAddressPoisoning,
  detectApprovals,
} from "./forensics.js";

export type {
  ApprovalFinding,
  HistoricalDataPoint,
  RiskSignal,
  WalletLinkabilityReport,
  WalletTransaction,
};

const PRO_REST_BASE = "https://api.blockscout.com";
const METADATA_BASE = "https://api.blockscout.com/services/metadata/api/v1";

export const CHAINS = [
  { chainId: 1, chainName: "Ethereum", nativeSymbol: "ETH", explorerUrl: "https://eth.blockscout.com", publicApiBase: "https://eth.blockscout.com/api/v2" },
  { chainId: 10, chainName: "Optimism", nativeSymbol: "ETH", explorerUrl: "https://optimism.blockscout.com", publicApiBase: "https://optimism.blockscout.com/api/v2" },
  { chainId: 42161, chainName: "Arbitrum", nativeSymbol: "ETH", explorerUrl: "https://arbitrum.blockscout.com", publicApiBase: "https://arbitrum.blockscout.com/api/v2" },
  { chainId: 8453, chainName: "Base", nativeSymbol: "ETH", explorerUrl: "https://base.blockscout.com", publicApiBase: "https://base.blockscout.com/api/v2" },
  { chainId: 137, chainName: "Polygon", nativeSymbol: "POL", explorerUrl: "https://polygon.blockscout.com", publicApiBase: "https://polygon.blockscout.com/api/v2" },
  { chainId: 100, chainName: "Gnosis", nativeSymbol: "xDAI", explorerUrl: "https://gnosis.blockscout.com", publicApiBase: "https://gnosis.blockscout.com/api/v2" },
  { chainId: 324, chainName: "zkSync Era", nativeSymbol: "ETH", explorerUrl: "https://zksync.blockscout.com", publicApiBase: "https://zksync.blockscout.com/api/v2" },
  { chainId: 534352, chainName: "Scroll", nativeSymbol: "ETH", explorerUrl: "https://scroll.blockscout.com", publicApiBase: "https://scroll.blockscout.com/api/v2" },
  { chainId: 59144, chainName: "Linea", nativeSymbol: "ETH", explorerUrl: "https://linea.blockscout.com", publicApiBase: "https://linea.blockscout.com/api/v2" },
  { chainId: 42220, chainName: "Celo", nativeSymbol: "CELO", explorerUrl: "https://celo.blockscout.com", publicApiBase: "https://celo.blockscout.com/api/v2" },
] as const;

export type SupportedChain = (typeof CHAINS)[number];
type JsonObject = Record<string, unknown>;

const PER_REQUEST_TIMEOUT_MS = 6_000;
const OVERALL_OVERVIEW_TIMEOUT_MS = 14_000;
const MAX_TX_PER_CHAIN = 25;
const MAX_TOKENS_PER_CHAIN = 30;
const CACHE_TTL_MS = 45_000;

export interface EnrichedChainWallet extends Omit<ChainWallet, "transactions"> {
  explorerUrl: string;
  addressExplorerUrl: string;
  totalTransactionsCount: number;
  totalTokenTransfersCount: number;
  tokens: Array<TokenBalance & { explorerTokenUrl: string }>;
  transactions: WalletTransaction[];
}

export interface EnrichedWalletOverview {
  address: string;
  ensName: string | null;
  chains: EnrichedChainWallet[];
  totalLifetimeTransactions: number;
  totalLifetimeTokenTransfers: number;
  sampledTransactionCount: number;
  approvals: ApprovalFinding[];
  riskSignals: RiskSignal[];
  linkability: WalletLinkabilityReport;
  history: HistoricalDataPoint[];
}

const overviewCache = new Map<string, { expiresAt: number; data: EnrichedWalletOverview }>();

export function getChainById(chainId: number | string): SupportedChain {
  const num = Number(chainId);
  return CHAINS.find((c) => c.chainId === num) ?? CHAINS[0];
}

export function objectOf(value: unknown): JsonObject {
  return value !== null && typeof value === "object" ? (value as JsonObject) : {};
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
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
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

  if (apiKey) {
    try {
      const proUrl = proChainRestUrl(chainId, endpoint, apiKey);
      const proRes = await fetchJsonWithTimeout(proUrl, PER_REQUEST_TIMEOUT_MS, parentSignal);
      if (proRes.ok) {
        return await proRes.json();
      }
    } catch {
      // Fallback to public Blockscout v2 instance
    }
  }

  const pubUrl = publicChainRestUrl(chainId, endpoint);
  const response = await fetchJsonWithTimeout(pubUrl, PER_REQUEST_TIMEOUT_MS, parentSignal);
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

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
  ensName: string | null;
  hasMetadata: boolean;
  totalTransactionsCount: number;
  totalTokenTransfersCount: number;
}> {
  const encoded = encodeURIComponent(address);
  const [addressData, countersData] = await Promise.all([
    readChainJson(chainId, `addresses/${encoded}`, "Native balance request", signal).catch(() => null),
    readChainJson(chainId, `addresses/${encoded}/counters`, "Address counters request", signal).catch(() => null),
  ]);

  const addrObj = objectOf(addressData);
  const rawBalance = addrObj.coin_balance;
  const nativeBalance =
    rawBalance !== null && rawBalance !== undefined && (typeof rawBalance === "string" || typeof rawBalance === "number")
      ? formatUnits(rawBalance, 18)
      : null;

  let nativePriceUsd = numberOf(addrObj.exchange_rate);
  if (nativePriceUsd === null && addressData !== null) {
    const statsObj = objectOf(
      await readChainJson(chainId, "stats", "Chain stats request", signal).catch(() => null),
    );
    nativePriceUsd = numberOf(statsObj.coin_price);
  }

  const ensName =
    typeof addrObj.ens_domain_name === "string" && addrObj.ens_domain_name
      ? addrObj.ens_domain_name
      : null;

  const publicTags = Array.isArray(addrObj.public_tags) ? addrObj.public_tags : [];
  const hasMetadata = Boolean(ensName || addrObj.name || publicTags.length > 0);

  const countersObj = objectOf(countersData);
  const totalTransactionsCount = numberOf(countersObj.transactions_count) ?? 0;
  const totalTokenTransfersCount = numberOf(countersObj.token_transfers_count) ?? 0;

  return {
    nativeBalance,
    nativePriceUsd,
    ensName,
    hasMetadata,
    totalTransactionsCount,
    totalTokenTransfersCount,
  };
}

export async function getTokenBalances(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<{ tokens: Array<TokenBalance & { explorerTokenUrl: string }>; incomplete: boolean }> {
  const data = await readChainJson(
    chainId,
    `addresses/${encodeURIComponent(address)}/token-balances`,
    "Token balances request",
    signal,
  );
  if (!Array.isArray(data)) {
    return { tokens: [], incomplete: true };
  }
  let incomplete = data.length > MAX_TOKENS_PER_CHAIN;
  const items = data.slice(0, MAX_TOKENS_PER_CHAIN);
  const tokens = items.flatMap((entry): Array<TokenBalance & { explorerTokenUrl: string }> => {
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
    const tokenAddress = stringOf(token.address_hash ?? token.address);

    return [
      {
        address: tokenAddress,
        name: stringOf(token.name, "Unknown token"),
        symbol: stringOf(token.symbol, "—"),
        decimals,
        balance,
        priceUsd,
        valueUsd:
          priceUsd !== null && Number.isFinite(balanceNumber)
            ? Number((balanceNumber * priceUsd).toFixed(2))
            : null,
        iconUrl:
          typeof token.icon_url === "string" && token.icon_url.length > 0
            ? token.icon_url
            : null,
        explorerTokenUrl: buildExplorerTokenUrl(getChainById(chainId).explorerUrl, tokenAddress),
      },
    ];
  });
  return { tokens, incomplete };
}

export async function getTransactions(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<WalletTransaction[]> {
  const chain = getChainById(chainId);
  const data = objectOf(
    await readChainJson(
      chainId,
      `addresses/${encodeURIComponent(address)}/transactions`,
      "Transaction history request",
      signal,
    ),
  );
  if (!Array.isArray(data.items)) {
    return [];
  }
  const items = data.items.slice(0, MAX_TX_PER_CHAIN);
  const normalized: WalletTransaction[] = [];

  for (const item of items) {
    const row = objectOf(item);
    const hash = stringOf(row.hash);
    const fromObj = objectOf(row.from);
    const toObj = objectOf(row.to);
    const from = stringOf(fromObj.hash);
    const to = toObj.hash ? stringOf(toObj.hash) : null;
    const toName = typeof toObj.name === "string" ? toObj.name : null;
    if (!hash || !from) continue;

    const timestampValue = row.timestamp ?? row.created_at;
    const timestamp = String(timestampValue ?? new Date().toISOString());
    const decodedInput = (row.decoded_input ?? null) as WalletTransaction["decodedInput"];
    const rawInput = typeof row.raw_input === "string" ? row.raw_input : undefined;

    let method =
      stringOf(row.method) ||
      (typeof decodedInput?.method_call === "string"
        ? decodedInput.method_call.split("(")[0]
        : null);

    if (
      rawInput &&
      (rawInput.startsWith("0x095ea7b3") ||
        rawInput.startsWith("0x39509351") ||
        rawInput.startsWith("0xa22cb465")) &&
      !method
    ) {
      method = "approve";
    }

    normalized.push({
      hash,
      chainId: chain.chainId,
      chainName: chain.chainName,
      timestamp,
      from,
      to,
      toName,
      value: stringOf(row.value, "0"),
      method,
      status: stringOf(row.status, row.is_error === true ? "failed" : "success"),
      rawInput,
      decodedInput,
      explorerTxUrl: buildExplorerTxUrl(chain.explorerUrl, hash),
      explorerFromUrl: buildExplorerAddressUrl(chain.explorerUrl, from),
      explorerToUrl: to ? buildExplorerAddressUrl(chain.explorerUrl, to) : null,
    });
  }

  return normalized;
}

async function getChainWallet(
  address: string,
  chain: SupportedChain,
  signal?: AbortSignal,
): Promise<{ wallet: EnrichedChainWallet; ensName: string | null; hasMetadata: boolean }> {
  const [summary, tokenResult, transactions] = await Promise.all([
    getAddressSummaryAndCounters(address, chain.chainId, signal).catch(() => ({
      nativeBalance: null,
      nativePriceUsd: null,
      ensName: null,
      hasMetadata: false,
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
    ensName: summary.ensName,
    hasMetadata: summary.hasMetadata,
    wallet: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      nativeSymbol: chain.nativeSymbol,
      nativeBalance: summary.nativeBalance,
      nativePriceUsd: summary.nativePriceUsd,
      tokens: tokenResult.tokens,
      tokenBalancesIncomplete: tokenResult.incomplete,
      transactions,
      explorerUrl: chain.explorerUrl,
      addressExplorerUrl: buildExplorerAddressUrl(chain.explorerUrl, address),
      totalTransactionsCount: Math.max(summary.totalTransactionsCount, transactions.length),
      totalTokenTransfersCount: summary.totalTokenTransfersCount,
    },
  };
}

export async function getWalletOverview(address: string): Promise<EnrichedWalletOverview> {
  const cacheKey = address.trim().toLowerCase();
  const cached = overviewCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERALL_OVERVIEW_TIMEOUT_MS);

  try {
    const settled = await Promise.allSettled(
      CHAINS.map((chain) => getChainWallet(address, chain, controller.signal)),
    );

    let ensName: string | null = null;
    let hasMetadata = false;
    const chains: EnrichedChainWallet[] = [];

    settled.forEach((result, idx) => {
      const chainCfg = CHAINS[idx];
      if (result.status === "fulfilled") {
        if (!ensName && result.value.ensName) ensName = result.value.ensName;
        if (result.value.hasMetadata) hasMetadata = true;
        chains.push(result.value.wallet);
      } else {
        chains.push({
          chainId: chainCfg.chainId,
          chainName: chainCfg.chainName,
          nativeSymbol: chainCfg.nativeSymbol,
          nativeBalance: null,
          nativePriceUsd: null,
          tokens: [],
          tokenBalancesIncomplete: true,
          transactions: [],
          explorerUrl: chainCfg.explorerUrl,
          addressExplorerUrl: buildExplorerAddressUrl(chainCfg.explorerUrl, address),
          totalTransactionsCount: 0,
          totalTokenTransfersCount: 0,
        });
      }
    });

    const explorerMap: Record<string, string> = {};
    for (const c of CHAINS) {
      explorerMap[String(c.chainId)] = c.explorerUrl;
    }

    const allTransactions = chains.flatMap((c) => c.transactions);
    const approvals = detectApprovals(address, allTransactions, explorerMap);
    const poisoningSignals = detectAddressPoisoning(address, allTransactions, explorerMap);

    const approvalRiskSignals: RiskSignal[] = approvals
      .filter((a) => a.isActive && a.allowanceType === "unlimited")
      .map((a) => ({
        id: `risk-approval-${a.chainId}-${a.txHash.slice(0, 10)}`,
        type: "unlimited_approval",
        severity: "high",
        title: `Unlimited Token Approval on ${a.chainName}`,
        description: `Spender ${a.spenderAddress.slice(0, 8)}…${a.spenderAddress.slice(-6)} has an active unlimited allowance for ${a.tokenName}.`,
        chainId: a.chainId,
        chainName: a.chainName,
        txHash: a.txHash,
        timestamp: a.timestamp,
        targetAddress: a.spenderAddress,
        tokenAddress: a.tokenAddress,
        explorerTxUrl: a.explorerTxUrl,
        explorerAddressUrl: a.explorerSpenderUrl,
      }));

    const riskSignals = [...poisoningSignals, ...approvalRiskSignals];
    const linkability = calculateLinkabilityScore(address, chains, hasMetadata, ensName);

    if (linkability.score >= 70) {
      riskSignals.push({
        id: `risk-linkability-${address.slice(0, 8)}`,
        type: "high_linkability",
        severity: "medium",
        title: `High Cross-Chain Linkability (${linkability.score}/100)`,
        description: linkability.summary,
        chainId: 1,
        chainName: "Multi-Chain",
        targetAddress: address,
        explorerAddressUrl: buildExplorerAddressUrl("https://eth.blockscout.com", address),
      });
    }

    const history = buildHistoricalPerformance(address, chains);
    const totalLifetimeTransactions = chains.reduce((sum, c) => sum + c.totalTransactionsCount, 0);
    const totalLifetimeTokenTransfers = chains.reduce((sum, c) => sum + c.totalTokenTransfersCount, 0);
    const sampledTransactionCount = allTransactions.length;

    const overview: EnrichedWalletOverview = {
      address,
      ensName,
      chains,
      totalLifetimeTransactions,
      totalLifetimeTokenTransfers,
      sampledTransactionCount,
      approvals,
      riskSignals,
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

export async function getAddressMetadata(address: string): Promise<AddressMetadata & { explorerAddressUrl?: string }> {
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

  if (!response) {
    response = await readChainJson(1, `addresses/${encodeURIComponent(address)}`, "Address metadata request");
  }

  const result = objectOf(response);
  const addressRecords = objectOf(result.addresses);
  const raw = objectOf(
    Array.isArray(response)
      ? response.find((entry) => {
          const row = objectOf(entry);
          return addressOf(row.address ?? row.hash).toLowerCase() === address.toLowerCase();
        })
      : addressRecords[address] ?? addressRecords[address.toLowerCase()] ?? result[address] ?? response,
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
  const iconUrl = firstString(raw.icon_url, raw.iconUrl, raw.image_url, metadata.icon_url);

  return {
    address,
    name,
    ensName,
    website,
    tags: [...new Set(tags)],
    iconUrl,
    hasMetadata: Boolean(name || ensName || website || iconUrl || tags.length),
    explorerAddressUrl: buildExplorerAddressUrl("https://eth.blockscout.com", address),
  };
}