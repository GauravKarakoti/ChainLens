import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHAINS,
  buildHistoricalPerformance,
  computeWalletLinkability,
  detectAddressPoisoning,
  detectApprovals,
  getExplorerUrl,
  isApprovalCandidate,
  lookalikeAddress,
  parseApprovalDetails,
} from "../blockscout";

const WALLET = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const LEGIT_COUNTERPARTY = "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503";
const POISON_LOOKALIKE = "0x47ac09999999999999999999999999999996d503";
const UNRELATED_ADDR = "0x1111111122222222333333334444444455555555";
const TOKEN_ADDR = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const SPENDER_ADDR = "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45";

describe("10+ Supported Chains & Explorer Links", () => {
  it("covers at least 10 EVM chains and builds valid Blockscout URLs", () => {
    assert.ok(CHAINS.length >= 10);
    assert.equal(
      getExplorerUrl(1, "tx", "0xabc"),
      "https://eth.blockscout.com/tx/0xabc",
    );
    assert.equal(
      getExplorerUrl(8453, "address", WALLET),
      `https://base.blockscout.com/address/${WALLET}`,
    );
  });
});

describe("Address Poisoning Detection", () => {
  it("flags vanity lookalike addresses with matching prefix and suffix", () => {
    const res = lookalikeAddress(POISON_LOOKALIKE, LEGIT_COUNTERPARTY);
    assert.equal(res.isMatch, true);
    assert.equal(res.prefix, 5);
    assert.equal(res.suffix, 5);
  });

  it("does not flag identical or unrelated addresses", () => {
    assert.equal(
      lookalikeAddress(LEGIT_COUNTERPARTY, LEGIT_COUNTERPARTY).isMatch,
      false,
    );
    assert.equal(
      lookalikeAddress(UNRELATED_ADDR, LEGIT_COUNTERPARTY).isMatch,
      false,
    );
  });

  it("detects address poisoning in transaction history and links to Blockscout", () => {
    const chains = [
      {
        chainId: 1,
        chainName: "Ethereum",
        transactions: [
          {
            hash: "0x1111",
            timestamp: new Date("2026-10-10T10:00:00Z"),
            from: WALLET,
            to: LEGIT_COUNTERPARTY,
            value: "1000000000000000000",
            method: "transfer",
            status: "success",
          },
          {
            hash: "0x2222",
            timestamp: new Date("2026-10-10T10:05:00Z"),
            from: POISON_LOOKALIKE,
            to: WALLET,
            value: "0",
            method: "transfer",
            status: "success",
          },
        ],
      },
    ];

    const findings = detectAddressPoisoning(WALLET, chains);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].suspiciousAddress, POISON_LOOKALIKE);
    assert.equal(findings[0].mimickedAddress, LEGIT_COUNTERPARTY);
    assert.equal(findings[0].isZeroValue, true);
    assert.equal(findings[0].txExplorerUrl, "https://eth.blockscout.com/tx/0x2222");
    assert.equal(
      findings[0].suspiciousExplorerUrl,
      `https://eth.blockscout.com/address/${POISON_LOOKALIKE}`,
    );
  });
});

describe("Approval Detection (Calldata & Decoded Input)", () => {
  it("detects unlimited ERC-20 approve from raw calldata without extra log calls", () => {
    const rawApprove =
      "0x095ea7b3" +
      "00000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc45" +
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    assert.equal(isApprovalCandidate({ raw_input: rawApprove }), true);
    const details = parseApprovalDetails({
      raw_input: rawApprove,
      status: "ok",
    });
    assert.ok(details);
    assert.equal(details.spenderAddress, SPENDER_ADDR);
    assert.equal(details.allowanceType, "unlimited");
  });

  it("detects approval revocation when amount is 0", () => {
    const details = parseApprovalDetails({
      method: "approve",
      status: "ok",
      decoded_input: {
        method_call: "approve(address spender, uint256 amount)",
        parameters: [
          { name: "spender", type: "address", value: SPENDER_ADDR },
          { name: "amount", type: "uint256", value: "0" },
        ],
      },
    });
    assert.ok(details);
    assert.equal(details.allowanceType, "revoked");
    assert.equal(details.formattedAllowance, "Revoked (0)");
  });

  it("extracts structured approval findings with Blockscout Explorer URLs", () => {
    const findings = detectApprovals([
      {
        chainId: 10,
        chainName: "Optimism",
        transactions: [
          {
            hash: "0x9999",
            timestamp: new Date("2026-10-12T12:00:00Z"),
            from: WALLET,
            to: TOKEN_ADDR,
            value: "0",
            method: `Approval event detected · approve (Unlimited (MAX)) · Spender ${SPENDER_ADDR}`,
            status: "success",
          },
        ],
      },
    ]);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].allowanceType, "unlimited");
    assert.equal(findings[0].spenderAddress, SPENDER_ADDR);
    assert.equal(
      findings[0].txExplorerUrl,
      "https://optimism.blockscout.com/tx/0x9999",
    );
    assert.equal(
      findings[0].spenderExplorerUrl,
      `https://optimism.blockscout.com/address/${SPENDER_ADDR}`,
    );
  });
});

describe("Wallet Linkability Score & Historical Charts", () => {
  it("computes cross-chain linkability score and historical chart series", () => {
    const chains = [
      {
        chainId: 1,
        chainName: "Ethereum",
        nativeBalance: "1.0",
        nativePriceUsd: 2500,
        tokens: [],
        transactions: [
          {
            hash: "0xtx1",
            timestamp: new Date("2026-10-15T14:00:00Z"),
            from: WALLET,
            to: LEGIT_COUNTERPARTY,
            value: "1000000000000000000",
            method: "transfer",
            status: "success",
          },
        ],
      },
      {
        chainId: 8453,
        chainName: "Base",
        nativeBalance: "0.5",
        nativePriceUsd: 2500,
        tokens: [],
        transactions: [
          {
            hash: "0xtx2",
            timestamp: new Date("2026-10-15T14:20:00Z"),
            from: WALLET,
            to: LEGIT_COUNTERPARTY,
            value: "1000000000000000000",
            method: "transfer",
            status: "success",
          },
        ],
      },
    ];

    const linkability = computeWalletLinkability(WALLET, chains, true);
    assert.ok(linkability.score >= 30);
    assert.equal(linkability.sharedCounterpartyCount, 1);
    assert.equal(linkability.sharedCounterparties[0].address, LEGIT_COUNTERPARTY);

    const history = buildHistoricalPerformance(chains);
    assert.equal(history.length, 1);
    assert.equal(history[0].txCount, 2);
    assert.equal(history[0].activeChains, 2);
  });
});