import { Router, type IRouter } from "express";
import {
  type ErrorResponse,
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

function errorBody(error: string): ErrorResponse {
  return { error };
}

function safeErrorContext(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const requestFailure = message.match(
    /^(Native balance request|Token balances request|Transaction history request|Chain stats request|Address counters request|Address metadata request) returned HTTP \d{3}/,
  );
  if (requestFailure) return requestFailure[0];

  if (
    error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name)
  ) {
    return "Blockscout request timed out";
  }
  return message || "Unclassified upstream response or transport failure";
}

router.get("/blockscout/status", (_req, res) => {
  res.json(
    GetBlockscoutStatusResponse.parse({
      configured: isBlockscoutConfigured(),
    }),
  );
});

router.get("/wallets/:address/overview", async (req, res): Promise<void> => {
  const params = GetWalletOverviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorBody("Enter a valid 0x-prefixed EVM address."));
    return;
  }

  try {
    const overview = await getWalletOverview(params.data.address);
    const parsed = GetWalletOverviewResponse.parse(overview);
    res.json({
      ...overview,
      ...parsed,
      chains: parsed.chains.map((chain, idx) => ({
        ...overview.chains[idx],
        ...chain,
      })),
    });
  } catch (error) {
    req.log.warn(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorContext: safeErrorContext(error),
      },
      "Blockscout wallet lookup failed",
    );
    res
      .status(502)
      .json(errorBody(`Blockscout request failed: ${safeErrorContext(error)}`));
  }
});

router.get("/addresses/:address/metadata", async (req, res): Promise<void> => {
  const params = GetAddressMetadataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorBody("Enter a valid 0x-prefixed EVM address."));
    return;
  }

  try {
    const metadata = await getAddressMetadata(params.data.address);
    res.json(GetAddressMetadataResponse.parse(metadata));
  } catch (error) {
    req.log.warn(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorContext: safeErrorContext(error),
      },
      "Blockscout address metadata lookup failed",
    );
    res
      .status(502)
      .json(
        errorBody(
          `Blockscout metadata request failed: ${safeErrorContext(error)}`,
        ),
      );
  }
});

export default router;