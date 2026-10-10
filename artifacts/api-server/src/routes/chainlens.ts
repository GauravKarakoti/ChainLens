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
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Blockscout wallet lookup failed",
    );
    res.status(502).json({ error: "Blockscout could not return wallet data." });
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
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Blockscout address metadata lookup failed",
    );
    res.status(502).json({ error: "Blockscout could not return address metadata." });
  }
});

export default router;
