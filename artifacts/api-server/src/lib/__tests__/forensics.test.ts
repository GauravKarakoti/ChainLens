import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type WalletTransaction,
  buildHistoricalPerformance,
  calculateLinkabilityScore,
  computeAddressSimilarity,
  detectAddressPoisoning,
  detectApprovals,
  parseApprovalFromTx,
} from "../forensics.js";

const USER_WALLET = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const LEGIT_COUNTERPARTY = "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503";
// Matches first 5 hex chars (47ac0) and last 5 hex chars (6d503) of LEGIT_COUNTERPARTY
const POISON_ATTACKER = "0x47ac09999999999999999999999999999996d503";
const RANDOM_ADDRESS = "0x1111111122222222333333334444444455555555";
const USDC_TOKEN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const SPENDER_UNISWAP = "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45";

function makeTx(overrides: Partial<WalletTransaction>): WalletTransaction {
  const hash =
    overrides.hash ??
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  return {
    hash,
    chainId: "1",
    chainName: "Ethereum",
    timestamp: "2026-10-01T12:00:00.000Z",
    from: USER_WALLET,
    to: LEGIT_COUNTERPARTY,
    value: "1000000000000000000",
    method: "transfer",
    status: "ok",
    explorerTxUrl: `https://eth.blockscout.com/tx/${hash}`,
    explorerFromUrl: `https://eth.blockscout.com/address/${USER_WALLET}`,
    explorerToUrl: `https://eth.blockscout.com/address/${LEGIT_COUNTERPARTY}`,
    ...overrides,
  };
}

describe("Address Poisoning Detection", () => {
  it("correctly identifies prefix + suffix vanity lookalike addresses", () => {
    const sim = computeAddressSimilarity(LEGIT_COUNTERPARTY, POISON_ATTACKER);
    assert.equal(sim.isLookalike, true);
    assert.ok(sim.prefixMatchLen >= 5);
    assert.ok(sim.suffixMatchLen >= 5);
  });

  it("does not flag identical addresses or unrelated addresses as lookalikes", () => {
    assert.equal(
      computeAddressSimilarity(LEGIT_COUNTERPARTY, LEGIT_COUNTERPARTY).isLookalike,
      false,
    );
    assert.equal(
      computeAddressSimilarity(LEGIT_COUNTERPARTY, RANDOM_ADDRESS).isLookalike,
      false,
    );
  });

  it("flags a zero-value/dust transfer from a lookalike address after legitimate interaction", () => {
    const txs: WalletTransaction[] = [
      makeTx({
        hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        timestamp: "2026-10-01T10:00:00.000Z",
        from: USER_WALLET,
        to: LEGIT_COUNTERPARTY,
        value: "2500000000000000000", // 2.5 ETH sent to legit address
      }),
      makeTx({
        hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        timestamp: "2026-10-01T10:05:00.000Z",
        from: POISON_ATTACKER,
        to: USER_WALLET,
        value: "0", // 0-value poisoning spoof
      }),
    ];

    const signals = detectAddressPoisoning(USER_WALLET, txs, {
      "1": "https://eth.blockscout.com",
    });

    const poisonSignal = signals.find((s) => s.type === "address_poisoning");
    assert.ok(poisonSignal, "Expected an address_poisoning risk signal");
    assert.equal(poisonSignal.severity, "critical");
    assert.equal(poisonSignal.targetAddress, POISON_ATTACKER);
    assert.equal(poisonSignal.mimickedAddress, LEGIT_COUNTERPARTY);
    assert.equal(
      poisonSignal.explorerTxUrl,
      "https://eth.blockscout.com/tx/0x2222222222222222222222222222222222222222222222222222222222222222",
    );
    assert.equal(
      poisonSignal.explorerAddressUrl,
      `https://eth.blockscout.com/address/${POISON_ATTACKER}`,
    );
  });

  it("detects unsolicited zero-value transfers from unknown senders", () => {
    const txs: WalletTransaction[] = [
      makeTx({
        hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        from: RANDOM_ADDRESS,
        to: USER_WALLET,
        value: "0",
        method: "transfer",
      }),
    ];

    const signals = detectAddressPoisoning(USER_WALLET, txs, {
      "1": "https://eth.blockscout.com",
    });

    const zeroSpoof = signals.find((s) => s.type === "zero_value_spoof");
    assert.ok(zeroSpoof, "Expected a zero_value_spoof signal");
    assert.equal(zeroSpoof.targetAddress, RANDOM_ADDRESS);
  });
});

describe("Approval Detection & Revocation State Tracking", () => {
  it("parses unlimited ERC-20 approve(address,uint256) from raw hex calldata without logs call", () => {
    const rawApproveUnlimited =
      "0x095ea7b3" +
      "00000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc45" +
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    const tx = makeTx({
      from: USER_WALLET,
      to: USDC_TOKEN,
      toName: "USD Coin",
      method: "approve",
      rawInput: rawApproveUnlimited,
    });

    const parsed = parseApprovalFromTx(tx, "https://eth.blockscout.com");
    assert.ok(parsed);
    assert.equal(parsed.spenderAddress, SPENDER_UNISWAP);
    assert.equal(parsed.allowanceType, "unlimited");
    assert.equal(parsed.method, "approve");
  });

  it("parses bounded approval from decodedInput parameters", () => {
    const tx = makeTx({
      from: USER_WALLET,
      to: USDC_TOKEN,
      method: "approve",
      decodedInput: {
        method_call: "approve(address spender, uint256 amount)",
        parameters: [
          { name: "spender", type: "address", value: SPENDER_UNISWAP },
          { name: "amount", type: "uint256", value: "500000000000000000000" },
        ],
      },
    });

    const parsed = parseApprovalFromTx(tx, "https://eth.blockscout.com");
    assert.ok(parsed);
    assert.equal(parsed.spenderAddress, SPENDER_UNISWAP);
    assert.equal(parsed.allowanceType, "bounded");
    assert.equal(parsed.formattedAllowance, "500");
  });

  it("tracks revocation when a subsequent approve(spender, 0) transaction occurs", () => {
    const approveTx = makeTx({
      hash: "0xaaaa111111111111111111111111111111111111111111111111111111111111",
      timestamp: "2026-10-01T10:00:00.000Z",
      from: USER_WALLET,
      to: USDC_TOKEN,
      toName: "USD Coin",
      method: "approve",
      decodedInput: {
        method_call: "approve(address spender, uint256 amount)",
        parameters: [
          { name: "spender", type: "address", value: SPENDER_UNISWAP },
          {
            name: "amount",
            type: "uint256",
            value:
              "115792089237316195423570985008687907853269984665640564039457584007913129639935",
          },
        ],
      },
    });

    const revokeTx = makeTx({
      hash: "0xbbbb222222222222222222222222222222222222222222222222222222222222",
      timestamp: "2026-10-02T10:00:00.000Z",
      from: USER_WALLET,
      to: USDC_TOKEN,
      toName: "USD Coin",
      method: "approve",
      decodedInput: {
        method_call: "approve(address spender, uint256 amount)",
        parameters: [
          { name: "spender", type: "address", value: SPENDER_UNISWAP },
          { name: "amount", type: "uint256", value: "0" },
        ],
      },
    });

    const findings = detectApprovals(USER_WALLET, [approveTx, revokeTx], {
      "1": "https://eth.blockscout.com",
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0].allowanceType, "revoked");
    assert.equal(findings[0].isActive, false);
    assert.equal(findings[0].txHash, revokeTx.hash);
    assert.equal(
      findings[0].explorerTxUrl,
      `https://eth.blockscout.com/tx/${revokeTx.hash}`,
    );
    assert.equal(
      findings[0].explorerSpenderUrl,
      `https://eth.blockscout.com/address/${SPENDER_UNISWAP}`,
    );
  });
});

describe("Wallet Linkability Score & Historical Performance", () => {
  it("computes cross-chain counterparty linkability and historical data points", () => {
    const ethTx = makeTx({
      chainId: "1",
      chainName: "Ethereum",
      timestamp: "2026-10-05T14:00:00.000Z",
      from: USER_WALLET,
      to: LEGIT_COUNTERPARTY,
      value: "1000000000000000000",
    });
    const baseTx = makeTx({
      chainId: "8453",
      chainName: "Base",
      timestamp: "2026-10-05T14:15:00.000Z",
      from: USER_WALLET,
      to: LEGIT_COUNTERPARTY,
      value: "500000000000000000",
      explorerTxUrl: `https://base.blockscout.com/tx/${ethTx.hash}`,
    });

    const chains = [
      {
        chainId: "1",
        chainName: "Ethereum",
        explorerUrl: "https://eth.blockscout.com",
        nativeBalance: "1.5",
        nativePriceUsd: 2500,
        totalTransactions: 12,
        tokens: [],
        transactions: [ethTx],
      },
      {
        chainId: "8453",
        chainName: "Base",
        explorerUrl: "https://base.blockscout.com",
        nativeBalance: "0.5",
        nativePriceUsd: 2500,
        totalTransactions: 8,
        tokens: [],
        transactions: [baseTx],
      },
    ];

    const report = calculateLinkabilityScore(USER_WALLET, chains, true, "vitalik.eth");
    assert.ok(report.score >= 35);
    assert.equal(report.sharedCounterpartyCount, 1);
    assert.equal(report.sharedCounterparties[0].address, LEGIT_COUNTERPARTY);
    assert.deepEqual(report.sharedCounterparties[0].chains, ["Ethereum", "Base"]);

    const history = buildHistoricalPerformance(USER_WALLET, chains);
    assert.equal(history.length, 1);
    assert.equal(history[0].date, "2026-10-05");
    assert.equal(history[0].txCount, 2);
    assert.equal(history[0].activeChains, 2);
  });
});