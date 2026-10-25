export interface ExplorerLinks {
  txUrl?: string;
  addressUrl?: string;
  tokenUrl?: string;
  spenderUrl?: string;
  counterpartyUrl?: string;
}

export interface WalletTransaction {
  hash: string;
  chainId: string | number;
  chainName: string;
  timestamp: string | Date;
  from: string;
  to: string | null;
  toName?: string | null;
  value: string;
  valueUsd?: number | null;
  feeWei?: string;
  method: string | null;
  status: string;
  rawInput?: string;
  decodedInput?: {
    method_call?: string;
    method_id?: string;
    parameters?: Array<{ name: string; type: string; value: unknown }>;
  } | null;
  isTokenTransfer?: boolean;
  tokenSymbol?: string | null;
  tokenAddress?: string | null;
  explorerTxUrl: string;
  explorerFromUrl: string;
  explorerToUrl: string | null;
}

export interface ApprovalFinding {
  id: string;
  chainId: string | number;
  chainName: string;
  txHash: string;
  timestamp: string | Date;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  spenderAddress: string;
  spenderName: string | null;
  allowanceType: "unlimited" | "bounded" | "revoked";
  rawAmount: string;
  formattedAllowance: string;
  method: string;
  riskLevel: "critical" | "high" | "medium" | "low";
  riskReason: string;
  isActive: boolean;
  explorerTxUrl: string;
  explorerTokenUrl: string;
  explorerSpenderUrl: string;
}

export interface RiskSignal {
  id: string;
  type:
    | "address_poisoning"
    | "unlimited_approval"
    | "suspicious_spender"
    | "zero_value_spoof"
    | "high_linkability"
    | "failed_tx_spike";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  chainId: string | number;
  chainName: string;
  txHash?: string;
  timestamp?: string | Date;
  targetAddress?: string;
  mimickedAddress?: string;
  tokenAddress?: string;
  explorerTxUrl?: string;
  explorerAddressUrl?: string;
  explorerMimickedUrl?: string;
}

export interface LinkabilityFactor {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  description: string;
  evidence: Array<{
    label: string;
    address?: string;
    chainName?: string;
    explorerUrl?: string;
  }>;
}

export interface WalletLinkabilityReport {
  score: number;
  level: "Low" | "Moderate" | "High" | "Critical";
  summary: string;
  activeChainCount: number;
  sharedCounterpartyCount: number;
  bridgeInteractionCount: number;
  factors: LinkabilityFactor[];
  sharedCounterparties: Array<{
    address: string;
    chains: string[];
    txCount: number;
    explorerUrls: Array<{ chainName: string; url: string }>;
  }>;
}

export interface HistoricalDataPoint {
  date: string;
  txCount: number;
  volumeUsd: number;
  inflowUsd: number;
  outflowUsd: number;
  cumulativeNetFlowUsd: number;
  activeChains: number;
}

const MAX_UINT256_HEX_PREFIX = "ffffffffffffffffffffffffffffffff";
const UNLIMITED_THRESHOLD = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000");

export function buildExplorerAddressUrl(explorerBaseUrl: string, address: string): string {
  const base = explorerBaseUrl.replace(/\/+$/, "");
  return `${base}/address/${address}`;
}

export function buildExplorerTxUrl(explorerBaseUrl: string, txHash: string): string {
  const base = explorerBaseUrl.replace(/\/+$/, "");
  return `${base}/tx/${txHash}`;
}

export function buildExplorerTokenUrl(explorerBaseUrl: string, tokenAddress: string): string {
  const base = explorerBaseUrl.replace(/\/+$/, "");
  return `${base}/token/${tokenAddress}`;
}

function normalizeAddr(address: string | null | undefined): string {
  return (address ?? "").trim().toLowerCase();
}

function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function parseApprovalFromTx(
  tx: WalletTransaction,
  explorerBaseUrl: string,
): {
  spenderAddress: string;
  rawAmount: string;
  allowanceType: "unlimited" | "bounded" | "revoked";
  formattedAllowance: string;
  method: string;
} | null {
  if (!tx.to || tx.status === "error" || tx.status === "failed" || tx.status === "reverted") {
    return null;
  }

  const rawInput = (tx.rawInput ?? "").toLowerCase();
  const selector = rawInput.slice(0, 10);
  const methodCall = (tx.decodedInput?.method_call ?? tx.method ?? "").toLowerCase();

  const isApproveSelector = selector === "0x095ea7b3";
  const isIncreaseAllowanceSelector = selector === "0x39509351";
  const isDecreaseAllowanceSelector = selector === "0xa457c2d7";
  const isSetApprovalForAllSelector = selector === "0xa22cb465";

  const isApproveMethod =
    isApproveSelector ||
    isIncreaseAllowanceSelector ||
    isDecreaseAllowanceSelector ||
    isSetApprovalForAllSelector ||
    methodCall.startsWith("approve(") ||
    methodCall.startsWith("increaseallowance(") ||
    methodCall.startsWith("setapprovalforall(") ||
    methodCall === "approve" ||
    methodCall === "increaseallowance" ||
    methodCall === "setapprovalforall";

  if (!isApproveMethod) {
    return null;
  }

  let spenderAddress = "";
  let amountBigInt: bigint | null = null;
  let isSetApprovalBool: boolean | null = null;

  const params = tx.decodedInput?.parameters ?? [];
  if (params.length >= 2) {
    const addrParam =
      params.find(
        (p) => p.type === "address" || /spender|operator|usr|guy|to/i.test(p.name),
      ) ?? params[0];
    if (addrParam && typeof addrParam.value === "string" && isValidEvmAddress(addrParam.value)) {
      spenderAddress = addrParam.value.toLowerCase();
    }

    const valParam =
      params.find(
        (p) =>
          p.type.startsWith("uint") ||
          p.type === "bool" ||
          /amount|value|wad|approved|addedvalue/i.test(p.name),
      ) ?? params[1];

    if (valParam !== undefined) {
      if (valParam.type === "bool" || typeof valParam.value === "boolean") {
        isSetApprovalBool =
          valParam.value === true ||
          String(valParam.value).toLowerCase() === "true" ||
          String(valParam.value) === "1";
      } else {
        try {
          amountBigInt = BigInt(String(valParam.value));
        } catch {
          amountBigInt = null;
        }
      }
    }
  }

  if ((!spenderAddress || (amountBigInt === null && isSetApprovalBool === null)) && rawInput.length >= 138) {
    const word1 = rawInput.slice(10, 74);
    const word2 = rawInput.slice(74, 138);
    const extractedAddr = `0x${word1.slice(24)}`;
    if (!spenderAddress && isValidEvmAddress(extractedAddr)) {
      spenderAddress = extractedAddr.toLowerCase();
    }
    if (isSetApprovalForAllSelector || methodCall.includes("setapprovalforall")) {
      try {
        isSetApprovalBool = BigInt(`0x${word2}`) !== 0n;
      } catch {
        isSetApprovalBool = false;
      }
    } else if (amountBigInt === null) {
      try {
        amountBigInt = BigInt(`0x${word2}`);
      } catch {
        amountBigInt = null;
      }
    }
  }

  if (!spenderAddress || !isValidEvmAddress(spenderAddress)) {
    return null;
  }

  const normalizedMethodName =
    isSetApprovalForAllSelector || methodCall.includes("setapprovalforall")
      ? "setApprovalForAll"
      : isIncreaseAllowanceSelector || methodCall.includes("increaseallowance")
        ? "increaseAllowance"
        : isDecreaseAllowanceSelector || methodCall.includes("decreaseallowance")
          ? "decreaseAllowance"
          : "approve";

  if (isSetApprovalBool !== null) {
    return {
      spenderAddress,
      rawAmount: isSetApprovalBool ? "ALL_COLLECTION" : "0",
      allowanceType: isSetApprovalBool ? "unlimited" : "revoked",
      formattedAllowance: isSetApprovalBool ? "Unlimited (All NFTs)" : "Revoked (0)",
      method: normalizedMethodName,
    };
  }

  if (amountBigInt === null) {
    return {
      spenderAddress,
      rawAmount: "unknown",
      allowanceType: "bounded",
      formattedAllowance: "Bounded Allowance",
      method: normalizedMethodName,
    };
  }

  if (amountBigInt === 0n) {
    return {
      spenderAddress,
      rawAmount: "0",
      allowanceType: "revoked",
      formattedAllowance: "Revoked (0)",
      method: normalizedMethodName,
    };
  }

  const hexVal = amountBigInt.toString(16).toLowerCase();
  const isUnlimited =
    amountBigInt >= UNLIMITED_THRESHOLD || hexVal.includes(MAX_UINT256_HEX_PREFIX);

  if (isUnlimited) {
    return {
      spenderAddress,
      rawAmount: amountBigInt.toString(),
      allowanceType: "unlimited",
      formattedAllowance: "Unlimited (MAX UINT256)",
      method: normalizedMethodName,
    };
  }

  const whole = amountBigInt / 10n ** 18n;
  const formattedAllowance =
    whole > 0n ? whole.toLocaleString("en-US") : amountBigInt.toString();

  return {
    spenderAddress,
    rawAmount: amountBigInt.toString(),
    allowanceType: "bounded",
    formattedAllowance,
    method: normalizedMethodName,
  };
}

export function detectApprovals(
  walletAddress: string,
  transactions: WalletTransaction[],
  explorerMap: Record<string, string>,
): ApprovalFinding[] {
  const normalizedWallet = normalizeAddr(walletAddress);
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const latestByPair = new Map<string, ApprovalFinding>();

  for (const tx of sorted) {
    if (normalizeAddr(tx.from) !== normalizedWallet || !tx.to) {
      continue;
    }

    const chainKey = String(tx.chainId);
    const explorerBase =
      explorerMap[chainKey] ??
      tx.explorerTxUrl.replace(/\/tx\/[^/]+$/, "") ??
      "https://eth.blockscout.com";

    const parsed = parseApprovalFromTx(tx, explorerBase);
    if (!parsed) continue;

    const tokenAddress = normalizeAddr(tx.to);
    const key = `${chainKey}:${tokenAddress}:${parsed.spenderAddress}`;

    const isUnlimited = parsed.allowanceType === "unlimited";
    const isRevoked = parsed.allowanceType === "revoked";

    const riskLevel: ApprovalFinding["riskLevel"] = isRevoked
      ? "low"
      : isUnlimited
        ? "critical"
        : "medium";

    const riskReason = isRevoked
      ? "Allowance was explicitly revoked in this transaction."
      : isUnlimited
        ? "Unlimited token approval grants the spender full control over this token balance unless revoked."
        : "Active bounded token allowance granted to spender contract.";

    latestByPair.set(key, {
      id: `${chainKey}-${tx.hash}`,
      chainId: tx.chainId,
      chainName: tx.chainName,
      txHash: tx.hash,
      timestamp: tx.timestamp,
      tokenAddress: tx.to,
      tokenName: tx.toName || tx.tokenSymbol || `Token (${tx.to.slice(0, 8)}…)`,
      tokenSymbol: tx.tokenSymbol || "ERC20",
      spenderAddress: parsed.spenderAddress,
      spenderName: null,
      allowanceType: parsed.allowanceType,
      rawAmount: parsed.rawAmount,
      formattedAllowance: parsed.formattedAllowance,
      method: parsed.method,
      riskLevel,
      riskReason,
      isActive: !isRevoked,
      explorerTxUrl: buildExplorerTxUrl(explorerBase, tx.hash),
      explorerTokenUrl: buildExplorerTokenUrl(explorerBase, tx.to),
      explorerSpenderUrl: buildExplorerAddressUrl(explorerBase, parsed.spenderAddress),
    });
  }

  return Array.from(latestByPair.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

export function computeAddressSimilarity(
  addrA: string,
  addrB: string,
): {
  isLookalike: boolean;
  prefixMatchLen: number;
  suffixMatchLen: number;
} {
  const a = normalizeAddr(addrA);
  const b = normalizeAddr(addrB);

  if (!isValidEvmAddress(a) || !isValidEvmAddress(b) || a === b) {
    return { isLookalike: false, prefixMatchLen: 0, suffixMatchLen: 0 };
  }

  const hexA = a.slice(2);
  const hexB = b.slice(2);

  let prefixMatchLen = 0;
  while (prefixMatchLen < 40 && hexA[prefixMatchLen] === hexB[prefixMatchLen]) {
    prefixMatchLen++;
  }

  let suffixMatchLen = 0;
  while (
    suffixMatchLen < 40 &&
    hexA[39 - suffixMatchLen] === hexB[39 - suffixMatchLen]
  ) {
    suffixMatchLen++;
  }

  const isLookalike =
    (prefixMatchLen >= 3 && suffixMatchLen >= 3 && prefixMatchLen + suffixMatchLen >= 7) ||
    prefixMatchLen >= 6 ||
    suffixMatchLen >= 6;

  return { isLookalike, prefixMatchLen, suffixMatchLen };
}

export function detectAddressPoisoning(
  walletAddress: string,
  transactions: WalletTransaction[],
  explorerMap: Record<string, string>,
): RiskSignal[] {
  const normalizedWallet = normalizeAddr(walletAddress);
  const signals: RiskSignal[] = [];
  const seenSignalKeys = new Set<string>();

  const chronological = [...transactions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const trustedCounterparties = new Set<string>();
  for (const tx of chronological) {
    const from = normalizeAddr(tx.from);
    const to = normalizeAddr(tx.to);
    if (!isValidEvmAddress(from) || !isValidEvmAddress(to)) continue;

    let valueBig = 0n;
    try {
      valueBig = BigInt(tx.value || "0");
    } catch {
      valueBig = 0n;
    }

    if (from === normalizedWallet && to !== normalizedWallet && valueBig > 0n) {
      let mimicsExisting = false;
      for (const existing of trustedCounterparties) {
        if (computeAddressSimilarity(to, existing).isLookalike) {
          mimicsExisting = true;
          break;
        }
      }
      if (!mimicsExisting) {
        trustedCounterparties.add(to);
      }
    }
  }

  const referenceTargets = new Set<string>([normalizedWallet, ...trustedCounterparties]);

  for (const tx of chronological) {
    const from = normalizeAddr(tx.from);
    const to = normalizeAddr(tx.to);
    const chainKey = String(tx.chainId);
    const explorerBase =
      explorerMap[chainKey] ??
      tx.explorerTxUrl.replace(/\/tx\/[^/]+$/, "") ??
      "https://eth.blockscout.com";

    const candidateAddresses = [from, to].filter(
      (addr) => isValidEvmAddress(addr) && addr !== normalizedWallet,
    );

    let valueBig = 0n;
    try {
      valueBig = BigInt(tx.value || "0");
    } catch {
      valueBig = 0n;
    }

    const isZeroOrDust = valueBig === 0n || (valueBig > 0n && valueBig <= 1000000000000n);
    const isIncoming = to === normalizedWallet && from !== normalizedWallet;

    for (const candidate of candidateAddresses) {
      for (const target of referenceTargets) {
        if (candidate === target) continue;
        const sim = computeAddressSimilarity(candidate, target);
        if (sim.isLookalike) {
          const signalKey = `poison:${chainKey}:${candidate}:${target}`;
          if (seenSignalKeys.has(signalKey)) continue;
          seenSignalKeys.add(signalKey);

          const severity: RiskSignal["severity"] =
            isIncoming && isZeroOrDust ? "critical" : "high";

          signals.push({
            id: `risk-poison-${chainKey}-${tx.hash.slice(0, 10)}`,
            type: "address_poisoning",
            severity,
            title: `Address Poisoning Lookalike Detected (${sim.prefixMatchLen} prefix / ${sim.suffixMatchLen} suffix hex match)`,
            description: `Address ${candidate.slice(0, 8)}…${candidate.slice(-6)} closely mimics ${
              target === normalizedWallet ? "your own wallet" : `known counterparty ${target.slice(0, 8)}…${target.slice(-6)}`
            } (${sim.prefixMatchLen} leading and ${sim.suffixMatchLen} trailing hex characters match).`,
            chainId: tx.chainId,
            chainName: tx.chainName,
            txHash: tx.hash,
            timestamp: tx.timestamp,
            targetAddress: candidate,
            mimickedAddress: target,
            explorerTxUrl: buildExplorerTxUrl(explorerBase, tx.hash),
            explorerAddressUrl: buildExplorerAddressUrl(explorerBase, candidate),
            explorerMimickedUrl: buildExplorerAddressUrl(explorerBase, target),
          });
        }
      }
    }

    if (
      isIncoming &&
      valueBig === 0n &&
      (!tx.method || tx.method === "transfer" || tx.method === "0x")
    ) {
      const spoofKey = `zero:${chainKey}:${from}`;
      if (!seenSignalKeys.has(spoofKey) && !trustedCounterparties.has(from)) {
        seenSignalKeys.add(spoofKey);
        signals.push({
          id: `risk-zero-${chainKey}-${tx.hash.slice(0, 10)}`,
          type: "zero_value_spoof",
          severity: "medium",
          title: "Unsolicited Zero-Value Transfer (History Spoofing Candidate)",
          description: `Received a 0-value transaction from unknown sender ${from.slice(0, 8)}…${from.slice(-6)} on ${tx.chainName}.`,
          chainId: tx.chainId,
          chainName: tx.chainName,
          txHash: tx.hash,
          timestamp: tx.timestamp,
          targetAddress: from,
          explorerTxUrl: buildExplorerTxUrl(explorerBase, tx.hash),
          explorerAddressUrl: buildExplorerAddressUrl(explorerBase, from),
        });
      }
    }
  }

  return signals;
}

export function calculateLinkabilityScore(
  walletAddress: string,
  chains: Array<{
    chainId: string | number;
    chainName: string;
    explorerUrl: string;
    nativeBalance: string | null;
    totalTransactionsCount?: number;
    tokens: Array<{ address: string; symbol: string }>;
    transactions: WalletTransaction[];
  }>,
  hasIdentityMetadata = false,
  ensName: string | null = null,
): WalletLinkabilityReport {
  const normalizedWallet = normalizeAddr(walletAddress);

  const activeChains = chains.filter(
    (c) =>
      c.transactions.length > 0 ||
      c.tokens.length > 0 ||
      (c.totalTransactionsCount ?? 0) > 0 ||
      Number(c.nativeBalance ?? 0) > 0,
  );

  const counterpartyChains = new Map<
    string,
    { chains: Set<string>; txCount: number; urls: Map<string, string> }
  >();

  let bridgeInteractionCount = 0;
  const bridgeEvidences: LinkabilityFactor["evidence"] = [];

  for (const chain of chains) {
    for (const tx of chain.transactions) {
      const from = normalizeAddr(tx.from);
      const to = normalizeAddr(tx.to);
      const other = from === normalizedWallet ? to : from;

      if (isValidEvmAddress(other) && other !== normalizedWallet) {
        const entry = counterpartyChains.get(other) ?? {
          chains: new Set<string>(),
          txCount: 0,
          urls: new Map<string, string>(),
        };
        entry.chains.add(chain.chainName);
        entry.txCount += 1;
        entry.urls.set(
          chain.chainName,
          buildExplorerAddressUrl(chain.explorerUrl, other),
        );
        counterpartyChains.set(other, entry);
      }

      const methodAndName = `${tx.method ?? ""} ${tx.toName ?? ""}`.toLowerCase();
      if (/bridge|deposit|relay|across|stargate|hop|orbiter|synapse|portal|l1|l2/i.test(methodAndName)) {
        bridgeInteractionCount++;
        if (bridgeEvidences.length < 4) {
          bridgeEvidences.push({
            label: `${chain.chainName}: ${tx.method || "Bridge Tx"} (${tx.hash.slice(0, 8)}…)`,
            address: tx.to ?? undefined,
            chainName: chain.chainName,
            explorerUrl: tx.explorerTxUrl,
          });
        }
      }
    }
  }

  const sharedCounterparties = Array.from(counterpartyChains.entries())
    .filter(([, info]) => info.chains.size >= 2)
    .map(([address, info]) => ({
      address,
      chains: Array.from(info.chains),
      txCount: info.txCount,
      explorerUrls: Array.from(info.urls.entries()).map(([chainName, url]) => ({
        chainName,
        url,
      })),
    }))
    .sort((a, b) => b.chains.length - a.chains.length || b.txCount - a.txCount);

  const counterpartyScore = Math.min(35, sharedCounterparties.length * 10);
  const footprintScore = Math.min(25, activeChains.length * 4);

  const hourBuckets = new Map<number, Set<string>>();
  for (const chain of chains) {
    for (const tx of chain.transactions) {
      const d = new Date(tx.timestamp);
      if (!Number.isNaN(d.getTime())) {
        const hour = d.getUTCHours();
        const set = hourBuckets.get(hour) ?? new Set<string>();
        set.add(chain.chainName);
        hourBuckets.set(hour, set);
      }
    }
  }
  const overlappingHours = Array.from(hourBuckets.values()).filter(
    (s) => s.size >= 2,
  ).length;
  const temporalAndBridgeScore = Math.min(
    20,
    overlappingHours * 3 + bridgeInteractionCount * 4,
  );

  const identityScore = ensName ? 20 : hasIdentityMetadata ? 12 : 0;
  const totalScore = Math.min(
    100,
    counterpartyScore + footprintScore + temporalAndBridgeScore + identityScore,
  );

  const level: WalletLinkabilityReport["level"] =
    totalScore >= 75
      ? "Critical"
      : totalScore >= 50
        ? "High"
        : totalScore >= 25
          ? "Moderate"
          : "Low";

  const factors: LinkabilityFactor[] = [
    {
      id: "counterparty-reuse",
      label: "Cross-Chain Counterparty Reuse",
      score: counterpartyScore,
      maxScore: 35,
      description:
        sharedCounterparties.length > 0
          ? `${sharedCounterparties.length} counterparty address(es) interacted with this wallet across 2 or more EVM chains.`
          : "No shared counterparties detected across multiple chains.",
      evidence: sharedCounterparties.slice(0, 4).map((item) => ({
        label: `${item.address.slice(0, 8)}…${item.address.slice(-6)} (${item.chains.join(", ")})`,
        address: item.address,
        chainName: item.chains[0],
        explorerUrl: item.explorerUrls[0]?.url,
      })),
    },
    {
      id: "chain-footprint",
      label: "Multi-Chain Address Reuse Footprint",
      score: footprintScore,
      maxScore: 25,
      description: `Identical EVM address is active across ${activeChains.length} of ${chains.length} inspected networks.`,
      evidence: activeChains.slice(0, 5).map((c) => ({
        label: `${c.chainName} (${c.totalTransactionsCount ?? c.transactions.length} txs)`,
        address: walletAddress,
        chainName: c.chainName,
        explorerUrl: buildExplorerAddressUrl(c.explorerUrl, walletAddress),
      })),
    },
    {
      id: "temporal-bridge",
      label: "Temporal & Bridge Correlation",
      score: temporalAndBridgeScore,
      maxScore: 20,
      description: `${overlappingHours} overlapping UTC activity window(s) and ${bridgeInteractionCount} bridge/cross-chain relay interaction(s) detected.`,
      evidence: bridgeEvidences,
    },
    {
      id: "identity-exposure",
      label: "ENS & Public Attribution Metadata",
      score: identityScore,
      maxScore: 20,
      description: ensName
        ? `Publicly linked to ENS domain ${ensName}.`
        : hasIdentityMetadata
          ? "Public address tags or metadata labels found on Blockscout."
          : "No public ENS or entity label directly attached.",
      evidence: ensName
        ? [
            {
              label: `ENS: ${ensName}`,
              address: walletAddress,
              explorerUrl: buildExplorerAddressUrl("https://eth.blockscout.com", walletAddress),
            },
          ]
        : [],
    },
  ];

  const summary =
    totalScore >= 50
      ? `High cross-chain linkability (${totalScore}/100): address reuse across ${activeChains.length} chains and ${sharedCounterparties.length} shared counterparties make multi-chain clustering straightforward.`
      : `Low-to-moderate cross-chain linkability (${totalScore}/100) across ${activeChains.length} active network(s).`;

  return {
    score: totalScore,
    level,
    summary,
    activeChainCount: activeChains.length,
    sharedCounterpartyCount: sharedCounterparties.length,
    bridgeInteractionCount,
    factors,
    sharedCounterparties: sharedCounterparties.slice(0, 10),
  };
}

export function buildHistoricalPerformance(
  walletAddress: string,
  chains: Array<{
    chainId: string | number;
    chainName: string;
    nativePriceUsd: number | null;
    transactions: WalletTransaction[];
  }>,
): HistoricalDataPoint[] {
  const normalizedWallet = normalizeAddr(walletAddress);
  const byDate = new Map<
    string,
    {
      txCount: number;
      inflowUsd: number;
      outflowUsd: number;
      chains: Set<string>;
    }
  >();

  for (const chain of chains) {
    const price = chain.nativePriceUsd ?? 0;
    for (const tx of chain.transactions) {
      if (!tx.timestamp) continue;
      const d = new Date(tx.timestamp);
      if (Number.isNaN(d.getTime())) continue;
      const dateKey = d.toISOString().slice(0, 10);

      const bucket = byDate.get(dateKey) ?? {
        txCount: 0,
        inflowUsd: 0,
        outflowUsd: 0,
        chains: new Set<string>(),
      };

      bucket.txCount += 1;
      bucket.chains.add(chain.chainName);

      let ethVal = 0;
      try {
        ethVal = Number(BigInt(tx.value || "0")) / 1e18;
      } catch {
        ethVal = 0;
      }
      const usdVal = tx.valueUsd ?? ethVal * price;

      if (normalizeAddr(tx.to) === normalizedWallet && normalizeAddr(tx.from) !== normalizedWallet) {
        bucket.inflowUsd += usdVal;
      } else if (normalizeAddr(tx.from) === normalizedWallet) {
        bucket.outflowUsd += usdVal;
      }

      byDate.set(dateKey, bucket);
    }
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  let cumulativeNetFlowUsd = 0;

  return sortedDates.map((date) => {
    const item = byDate.get(date)!;
    const net = item.inflowUsd - item.outflowUsd;
    cumulativeNetFlowUsd += net;
    return {
      date,
      txCount: item.txCount,
      volumeUsd: Number((item.inflowUsd + item.outflowUsd).toFixed(2)),
      inflowUsd: Number(item.inflowUsd.toFixed(2)),
      outflowUsd: Number(item.outflowUsd.toFixed(2)),
      cumulativeNetFlowUsd: Number(cumulativeNetFlowUsd.toFixed(2)),
      activeChains: item.chains.size,
    };
  });
}