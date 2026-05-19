import type { WalletRequest } from "./wallet-request";

export type WalletRequestSimulationInput = {
  accountAddress: string;
  balanceAtomic: number;
  request: WalletRequest;
};

export type DecodedWalletIntent = {
  intentTitle: string;
  to: string;
  amountAtomic: bigint;
  asset: string;
  memo?: string;
  invalidAmount: boolean;
  invalidAmountDomain: boolean;
  invalidAmountLength: boolean;
  invalidAssetLength: boolean;
  invalidMemoLength: boolean;
};

export type WalletRequestSimulation = {
  amountAtomic: bigint;
  feeAtomic: bigint;
  balanceDeltaAtomic: bigint;
  postBalanceAtomic: bigint;
  riskFlags: string[];
};

const KNOWN_METHODS = new Set(["sendTransaction", "escrow.release", "escrow.release()"]);
const MAX_AMOUNT_TEXT_LENGTH = 128;
const MAX_ASSET_TEXT_LENGTH = 32;
const MAX_MEMO_TEXT_LENGTH = 512;
const MAX_ACCOUNT_ADDRESS_LENGTH = 128;
const MAX_REQUEST_ORIGIN_LENGTH = 256;
const MAX_RECIPIENT_LENGTH = 128;

function payloadString(payload: Record<string, unknown>, key: string): string {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

export function decodeWalletRequestIntent(request: WalletRequest): DecodedWalletIntent {
  const to = payloadString(request.payload, "to") || "unknown.spc";
  const amountText = payloadString(request.payload, "amount") || "0";
  const assetText = payloadString(request.payload, "asset");
  const memoText = payloadString(request.payload, "memo");
  const invalidAssetLength = assetText.length > MAX_ASSET_TEXT_LENGTH;
  const invalidMemoLength = memoText.length > MAX_MEMO_TEXT_LENGTH;
  const asset = invalidAssetLength ? "SPC" : assetText || "SPC";
  const memo = invalidMemoLength ? undefined : memoText || undefined;

  let amountAtomic = 0n;
  let invalidAmount = false;
  let invalidAmountDomain = false;
  let invalidAmountLength = false;
  if (amountText.length > MAX_AMOUNT_TEXT_LENGTH) {
    invalidAmountLength = true;
  } else {
    try {
      amountAtomic = BigInt(amountText);
      if (amountAtomic < 0n) {
        amountAtomic = 0n;
        invalidAmountDomain = true;
      }
    } catch {
      invalidAmount = true;
    }
  }

  return {
    intentTitle: `Send ${asset}`,
    to,
    amountAtomic,
    asset,
    memo,
    invalidAmount,
    invalidAmountDomain,
    invalidAmountLength,
    invalidAssetLength,
    invalidMemoLength,
  };
}

export function simulateWalletRequest(input: WalletRequestSimulationInput): WalletRequestSimulation {
  const decoded = decodeWalletRequestIntent(input.request);
  const feeAtomic = 120n;
  const accountAddressText = typeof input.accountAddress === "string" ? input.accountAddress : "";
  const requestOriginText = typeof input.request.origin === "string" ? input.request.origin : "";
  const normalizedAccountAddress = accountAddressText.trim();
  const normalizedRequestOrigin = requestOriginText.trim();
  const hasValidAccountAddressDomain =
    normalizedAccountAddress.length > 0 &&
    normalizedAccountAddress.length <= MAX_ACCOUNT_ADDRESS_LENGTH &&
    normalizedAccountAddress === accountAddressText;
  const hasValidRequestOriginDomain =
    normalizedRequestOrigin.length > 0 &&
    normalizedRequestOrigin.length <= MAX_REQUEST_ORIGIN_LENGTH &&
    normalizedRequestOrigin === requestOriginText;
  const normalizedRecipient = decoded.to.trim();
  const hasValidRecipientDomain =
    normalizedRecipient.length > 0 &&
    normalizedRecipient.length <= MAX_RECIPIENT_LENGTH &&
    normalizedRecipient === decoded.to;
  const hasValidBalanceDomain =
    Number.isFinite(input.balanceAtomic) &&
    Number.isInteger(input.balanceAtomic) &&
    Number.isSafeInteger(input.balanceAtomic);
  const balanceAtomic = hasValidBalanceDomain ? BigInt(input.balanceAtomic) : 0n;
  const totalCost = decoded.amountAtomic + feeAtomic;
  const postBalanceAtomic = balanceAtomic - totalCost;

  const riskFlags: string[] = [];

  if (decoded.amountAtomic >= 50_000n) {
    riskFlags.push("high_amount");
  }

  if (decoded.invalidAmount) {
    riskFlags.push("invalid_amount");
  }

  if (decoded.invalidAmountDomain) {
    riskFlags.push("invalid_amount_domain");
  }

  if (decoded.invalidAmountLength) {
    riskFlags.push("invalid_amount_length");
  }

  if (decoded.invalidAssetLength) {
    riskFlags.push("invalid_asset_length");
  }

  if (decoded.invalidMemoLength) {
    riskFlags.push("invalid_memo_length");
  }

  if (!hasValidBalanceDomain) {
    riskFlags.push("invalid_balance_domain");
  }

  if (!hasValidAccountAddressDomain) {
    riskFlags.push("invalid_account_address_domain");
  }

  if (!hasValidRequestOriginDomain) {
    riskFlags.push("invalid_request_origin_domain");
  }

  if (!hasValidRecipientDomain) {
    riskFlags.push("invalid_recipient_domain");
  }

  if (!KNOWN_METHODS.has(input.request.method)) {
    riskFlags.push("unknown_method");
  }

  if (postBalanceAtomic < 0n) {
    riskFlags.push("insufficient_funds");
  }

  return {
    amountAtomic: decoded.amountAtomic,
    feeAtomic,
    balanceDeltaAtomic: -totalCost,
    postBalanceAtomic,
    riskFlags,
  };
}
