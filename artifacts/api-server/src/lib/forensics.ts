export interface ExplorerLinks {
  txUrl?: string;
  addressUrl?: string;
  tokenUrl?: string;
  spenderUrl?: string;
  counterpartyUrl?: string;
}

export interface WalletTransaction {
  hash: string;
  chainId: string;
  chainName: string;
  timestamp: string;
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
  chainId: string;
  chainName: string;
  txHash: string;
  timestamp: string;
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
  chainId: string;
  chainName: string;
  txHash?: string;
  timestamp?: string;
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
  score: number; // 0 - 100
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

/**
 * Parses ERC-20 / ERC-721 / ERC-1155 / Permit2 approval details directly from a transaction's
 * decoded_input or raw_input calldata without requiring an extra /logs HTTP call.
 */
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

  const isApproveSelector = selector === "0x095ea7b3"; // approve(address,uint256)
  const isIncreaseAllowanceSelector = selector === "0x39509351"; // increaseAllowance(address,uint256)
  const isDecreaseAllowanceSelector = selector === "0xa457c2d7"; // decreaseAllowance(address,uint256)
  const isSetApprovalForAllSelector = selector === "0xa22cb465"; // setApprovalForAll(address,bool)

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

  // 1. Try decodedInput parameters first
  const params = tx.decodedInput?.parameters ?? [];
  if (params.length >= 2) {
    const addrParam = params.find(
      (p) =>
        p.type === "address" ||
        /spender|operator|usr|guy|to/i.test(p.name),
    ) ?? params[0];
    if (addrParam && typeof addrParam.value === "string" && isValidEvmAddress(addrParam.value)) {
      spenderAddress = addrParam.value.toLowerCase();
    }

    const valParam = params.find(
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

  // 2. Fallback to raw hex calldata decoding (0x + 8-char selector + 64-char arg1 + 64-char arg2)
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
    // Method matched approve, default to bounded unknown if calldata was truncated
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

  // Format with 18 decimals estimate for readability
  const whole = amountBigInt / 10n ** 18n;
  const formattedAllowance =
    whole > 0n
      ?whole.toLocaleString("en-US")
      : amountBigInt.toString();

  return {
    spenderAddress,
    rawAmount: amountBigInt.toString(),
    allowanceType: "bounded",
    formattedAllowance,
    method: normalizedMethodName,
  };
}

/**
 * Scans transactions across chains to detect ERC-20/721/1155 approvals and tracks latest state
 * per (chainId, tokenAddress, spenderAddress) pair so revocations properly update status.
 */
export function detectApprovals(
  walletAddress: string,
  transactions: WalletTransaction[],
  explorerMap: Record<string, string>,
): ApprovalFinding[] {
  const normalizedWallet = normalizeAddr(walletAddress);
  // Sort oldest -> newest so latest state for (chainId, token, spender) wins
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const latestByPair = new Map<string, ApprovalFinding>();

  for (const tx of sorted) {
    if (normalizeAddr(tx.from) !== normalizedWallet || !tx.to) {
      continue;
    }

    const explorerBase =
      explorerMap[tx.chainId] ??
      tx.explorerTxUrl.replace(/\/tx\/[^/]+$/, "") ??
      "https://eth.blockscout.com";

    const parsed = parseApprovalFromTx(tx, explorerBase);
    if (!parsed) continue;

    const tokenAddress = normalizeAddr(tx.to);
    const key = `${tx.chainId}:${tokenAddress}:${parsed.spenderAddress}`;

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
      id: `${tx.chainId}-${tx.hash}`,
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

/**
 * Checks whether two EVM addresses exhibit vanity prefix/suffix similarity
 * used in address poisoning attacks.
 */
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

  // Poisoners typically match >= 3 prefix + >= 3 suffix chars (total >= 7) or >= 5 prefix/suffix chars
  const isLookalike =
    (prefixMatchLen >= 3 && suffixMatchLen >= 3 && prefixMatchLen + suffixMatchLen >= 7) ||
    prefixMatchLen >= 6 ||
    suffixMatchLen >= 6;

  return { isLookalike, prefixMatchLen, suffixMatchLen };
}

/**
 * Detects address poisoning and zero-value/dust spoofing attacks across wallet transactions.
 *
 * Heuristics:
 * 1. Builds the set of trusted/legitimate counterparties that the wallet has actively sent funds to
 *    or interacted with meaningfully.
 * 2. Flags any counterparty or incoming sender whose address is a vanity lookalike (matching prefix/suffix,
 *    differing middle bytes) of a legitimate counterparty or of the wallet itself.
 * 3. Flags unsolicited zero-value or dust transfers designed to pollute transaction history.
 */
export function detectAddressPoisoning(
  walletAddress: string,
  transactions: WalletTransaction[],
  explorerMap: Record<string, string>,
): RiskSignal[] {
  const normalizedWallet = normalizeAddr(walletAddress);
  const signals: RiskSignal[] = [];
  const seenSignalKeys = new Set<string>();

  // 1. Identify legitimate outbound counterparties (sorted chronologically)
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

    // Outbound non-zero transaction establishes a trusted counterparty first
    if (from === normalizedWallet && to !== normalizedWallet && valueBig > 0n) {
      // Only mark as trusted if it doesn't already mimic an earlier trusted counterparty
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

  // Also include the wallet's own address as a reference target for self-mimicry poisoning
  const referenceTargets = new Set<string>([normalizedWallet, ...trustedCounterparties]);

  for (const tx of chronological) {
    const from = normalizeAddr(tx.from);
    const to = normalizeAddr(tx.to);
    const explorerBase =
      explorerMap[tx.chainId] ??
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

    const isZeroOrDust = valueBig === 0n || (valueBig > 0n && valueBig <= 1000000000000n); // <= 1e-6 ETH
    const isIncoming = to === normalizedWallet && from !== normalizedWallet;

    for (const candidate of candidateAddresses) {
      for (const target of referenceTargets) {
        if (candidate === target) continue;
        const sim = computeAddressSimilarity(candidate, target);
        if (sim.isLookalike) {
          const signalKey = `poison:${tx.chainId}:${candidate}:${target}`;
          if (seenSignalKeys.has(signalKey)) continue;
          seenSignalKeys.add(signalKey);

          const severity: RiskSignal["severity"] =
            isIncoming && isZeroOrDust ? "critical" : "high";

          signals.push({
            id: `risk-poison-${tx.chainId}-${tx.hash.slice(0, 10)}`,
            type: "address_poisoning",
            severity,
            title: `Address Poisoning Lookalike Detected (${sim.prefixMatchLen} prefix / ${sim.suffixMatchLen} suffix hex match)`,
            description: `Address ${candidate.slice(0, 8)}…${candidate.slice(-6)} closely mimics ${
              target === normalizedWallet ? "your own wallet" : `known counterparty ${target.slice(0, 8)}…${target.slice(-6)}`
            } (${sim.prefixMatchLen} leading and ${sim.suffixMatchLen} trailing hex characters match). ${
              isIncoming && isZeroOrDust
                ? "It sent a zero/dust transfer to pollute your transaction history."
                : "Verify the full 42-character address before copying from history."
            }`,
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

    // Detect unsolicited incoming zero-value native/token transfer spoofing
    if (
      isIncoming &&
      valueBig === 0n &&
      (!tx.method || tx.method === "transfer" || tx.method === "0x")
    ) {
      const spoofKey = `zero:${tx.chainId}:${from}`;
      if (!seenSignalKeys.has(spoofKey) && !trustedCounterparties.has(from)) {
        seenSignalKeys.add(spoofKey);
        signals.push({
          id: `risk-zero-${tx.chainId}-${tx.hash.slice(0, 10)}`,
          type: "zero_value_spoof",
          severity: "medium",
          title: "Unsolicited Zero-Value Transfer (History Spoofing Candidate)",
          description: `Received a 0-value transaction from unknown sender ${from.slice(0, 8)}…${from.slice(-6)} on ${tx.chainName}. Attackers frequently use 0-value transfers to inject spoofed entries into wallet activity feeds.`,
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

/**
 * Computes a deterministic Wallet Linkability Score (0-100) evaluating how easily
 * the wallet's multi-chain activity and identity can be correlated across networks.
 */
export function calculateLinkabilityScore(
  walletAddress: string,
  chains: Array<{
    chainId: string;
    chainName: string;
    explorerUrl: string;
    nativeBalance: string;
    totalTransactions?: number;
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
      (c.totalTransactions ?? 0) > 0 ||
      Number(c.nativeBalance) > 0,
  );

  // 1. Cross-chain counterparty reuse (up to 35 pts)
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

  // 2. Multi-chain footprint density (up to 25 pts)
  const footprintScore = Math.min(25, activeChains.length * 4);

  // 3. Temporal correlation & bridge usage (up to 20 pts)
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

  // 4. Public Identity & ENS / Metadata exposure (up to 20 pts)
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
        label: `${c.chainName} (${c.totalTransactions ?? c.transactions.length} txs)`,
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
              explorerUrl: buildExplorerAddressUrl(
                "https://eth.blockscout.com",
                walletAddress,
              ),
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

/**
 * Aggregates multi-chain transactions into a daily/bucketed historical performance
 * and activity series for charts.
 */
export function buildHistoricalPerformance(
  walletAddress: string,
  chains: Array<{
    chainId: string;
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