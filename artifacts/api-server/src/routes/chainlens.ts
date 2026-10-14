import { Router, type IRouter } from "express";
import {
  GetAddressMetadataParams,
  GetAddressMetadataResponse,
  GetBlockscoutStatusResponse,
  GetWalletOverviewParams,
  GetWalletOverviewResponse,
} from "@workspace/api-zod";
import {
  getAddressMetadata,
  getWalletOverview,
  isBlockscoutConfigured,
} from "../lib/blockscout";

const router: IRouter = Router();

function isMissingApiKey(error: unknown): boolean {
  return error instanceof Error && error.name === "BlockscoutKeyMissingError";
}

function safeErrorContext(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const requestFailure = message.match(
    /^(Native balance request|Token balances request|Transaction history request|Chain stats request|Transaction logs request|Address metadata request) returned HTTP \d{3}$/,
  );
  if (requestFailure) return requestFailure[0];

  const knownFailures = new Set([
    "Blockscout rejected the native balance request",
    "Blockscout returned an unexpected native balance response",
    "Blockscout returned an unexpected token balances response",
    "Blockscout returned a token without valid decimals",
    "Blockscout returned a token without a balance",
    "Blockscout returned an unexpected transaction history response",
  ]);
  if (knownFailures.has(message)) return message;
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
    return "Blockscout request timed out";
  }
  return "Unclassified upstream response or transport failure";
}

router.get("/blockscout/status", (_req, res) => {
  res.json(GetBlockscoutStatusResponse.parse({
    configured: isBlockscoutConfigured(),
  }));
});

router.get("/wallets/:address/overview", async (req, res): Promise<void> => {
  const params = GetWalletOverviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Enter a valid 0x-prefixed EVM address." });
    return;
  }

  try {
    const overview = await getWalletOverview(params.data.address);
    res.json(GetWalletOverviewResponse.parse(overview));
  } catch (error) {
    if (isMissingApiKey(error)) {
      res.status(503).json({
        error: "API Key is not set. Add BLOCKSCOUT_PRO_API_KEY to project secrets.",
      });
      return;
    }
    req.log.warn(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorContext: safeErrorContext(error),
      },
      "Blockscout wallet lookup failed",
    );
    res.status(502).json({
      error: `Blockscout request failed: ${safeErrorContext(error)}`,
    });
  }
});

router.get("/addresses/:address/metadata", async (req, res): Promise<void> => {
  const params = GetAddressMetadataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Enter a valid 0x-prefixed EVM address." });
    return;
  }

  try {
    const metadata = await getAddressMetadata(params.data.address);
    res.json(GetAddressMetadataResponse.parse(metadata));
  } catch (error) {
    if (isMissingApiKey(error)) {
      res.status(503).json({
        error: "API Key is not set. Add BLOCKSCOUT_PRO_API_KEY to project secrets.",
      });
      return;
    }
    req.log.warn(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorContext: safeErrorContext(error),
      },
      "Blockscout address metadata lookup failed",
    );
    res.status(502).json({
      error: `Blockscout metadata request failed: ${safeErrorContext(error)}`,
    });
  }
});

export default router;
