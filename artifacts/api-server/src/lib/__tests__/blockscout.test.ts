import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHAINS,
  formatUnits,
  getChainById,
  numberOf,
} from "../blockscout.js";
import {
  buildExplorerAddressUrl,
  buildExplorerTokenUrl,
  buildExplorerTxUrl,
} from "../forensics.js";

const WALLET = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const TOKEN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

describe("10+ Supported Chains & Explorer Links", () => {
  it("covers at least 10 EVM chains with unique ids", () => {
    assert.ok(CHAINS.length >= 10);
    const ids = new Set(CHAINS.map((c) => c.chainId));
    assert.equal(ids.size, CHAINS.length);
  });

  it("resolves chains by numeric or string id and falls back to Ethereum", () => {
    assert.equal(getChainById(8453).chainName, "Base");
    assert.equal(getChainById("10").chainName, "Optimism");
    assert.equal(getChainById(999999).chainId, 1);
  });

  it("builds valid Blockscout explorer URLs for every chain", () => {
    for (const chain of CHAINS) {
      assert.match(chain.explorerUrl, /^https:\/\/[a-z0-9.-]+\.blockscout\.com$/);
    }
    assert.equal(
      buildExplorerTxUrl(getChainById(1).explorerUrl, "0xabc"),
      "https://eth.blockscout.com/tx/0xabc",
    );
    assert.equal(
      buildExplorerAddressUrl(getChainById(8453).explorerUrl, WALLET),
      `https://base.blockscout.com/address/${WALLET}`,
    );
    assert.equal(
      buildExplorerTokenUrl(getChainById(10).explorerUrl, TOKEN),
      `https://optimism.blockscout.com/token/${TOKEN}`,
    );
  });

  it("tolerates trailing slashes on the explorer base URL", () => {
    assert.equal(
      buildExplorerTxUrl("https://eth.blockscout.com///", "0xabc"),
      "https://eth.blockscout.com/tx/0xabc",
    );
  });
});

describe("Blockscout value helpers", () => {
  it("formats raw integer units using token decimals", () => {
    assert.equal(formatUnits("1000000000000000000", 18), "1");
    assert.equal(formatUnits("1500000", 6), "1.5");
    assert.equal(formatUnits("42", 0), "42");
    assert.equal(formatUnits("-2500", 3), "-2.5");
  });

  it("returns 0 for malformed values or decimals", () => {
    assert.equal(formatUnits("not-a-number", 18), "0");
    assert.equal(formatUnits("100", -1), "0");
    assert.equal(formatUnits("1.5", 2), "0");
  });

  it("parses numeric strings and rejects non-finite input", () => {
    assert.equal(numberOf("12.5"), 12.5);
    assert.equal(numberOf(7), 7);
    assert.equal(numberOf(""), null);
    assert.equal(numberOf(Number.NaN), null);
    assert.equal(numberOf(undefined), null);
  });
});