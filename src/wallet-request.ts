import { createHash } from "crypto";
import { isDisallowedHost } from "./session-runtime";

export type WalletRequest = {
  requestId: string;
  origin: string;
  method: string;
  chainId: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  payload: Record<string, unknown>;
};

export type WalletRequestValidation = {
  ok: boolean;
  errors: string[];
};

export type ApprovalDecisionInput = {
  approved: boolean;
  signerAddress: string;
  signature?: string;
  rejectionReason?: string;
  decidedAtMs: number;
};

export type WalletApprovalResponse = {
  requestId: string;
  chainId: string;
  nonce: string;
  origin: string;
  method: string;
  payloadHash: string;
  signerAddress: string;
  status: "approved" | "rejected";
  signature?: string;
  rejectionReason?: string;
  decidedAtMs: number;
};

const MAX_TTL_MS = 15 * 60_000;
const MAX_ISSUED_AT_SKEW_MS = 60_000;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_CHAIN_ID_LENGTH = 64;
const MAX_METHOD_LENGTH = 64;
const MAX_NONCE_LENGTH = 128;
const MAX_ORIGIN_LENGTH = 2048;
const SIGNATURE_HEX_LEN = 64;
const MAX_REJECTION_REASON_LENGTH = 256;
const MAX_SIGNER_ADDRESS_LENGTH = 128;

function isFiniteIntegerTimestamp(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

function isObjectPayload(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidApprovalSignature(signature: string): boolean {
  return /^[a-f0-9]{64}$/i.test(signature);
}

function isHttpsNonLocalhost(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") {
      return false;
    }
    return !isDisallowedHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function isWalletRequestExpired(request: WalletRequest, nowMs: number): boolean {
  return nowMs > request.expiresAtMs;
}

export function validateWalletRequest(
  request: WalletRequest,
  nowMs: number,
): WalletRequestValidation {
  const errors: string[] = [];
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    errors.push("request envelope object is required");
    return { ok: false, errors };
  }
  if (
    typeof request.requestId !== "string" ||
    typeof request.origin !== "string" ||
    typeof request.method !== "string" ||
    typeof request.chainId !== "string" ||
    typeof request.nonce !== "string"
  ) {
    errors.push("request envelope fields must be strings");
    return { ok: false, errors };
  }
  const requestIdCanonical = request.requestId.trim() === request.requestId;
  const methodCanonical = request.method.trim() === request.method;
  const chainIdCanonical = request.chainId.trim() === request.chainId;
  const nonceCanonical = request.nonce.trim() === request.nonce;
  const originCanonical = request.origin.trim() === request.origin;
  if (!isFiniteIntegerTimestamp(nowMs)) {
    errors.push("validation nowMs must be a finite integer timestamp");
  }

  if (!request.requestId.trim()) {
    errors.push("requestId is required");
  }
  if (request.requestId.length > MAX_REQUEST_ID_LENGTH) {
    errors.push("requestId exceeds max length");
  }

  if (!isHttpsNonLocalhost(request.origin)) {
    errors.push("origin must be https and non-localhost");
  }
  if (request.origin.length > MAX_ORIGIN_LENGTH) {
    errors.push("origin exceeds max length");
  }
  if (!originCanonical) {
    errors.push("origin must be canonical (trim-stable)");
  }

  if (!request.method.trim()) {
    errors.push("method is required");
  }
  if (request.method.length > MAX_METHOD_LENGTH) {
    errors.push("method exceeds max length");
  }

  if (!request.chainId.trim()) {
    errors.push("chainId is required");
  }
  if (request.chainId.length > MAX_CHAIN_ID_LENGTH) {
    errors.push("chainId exceeds max length");
  }

  if (!request.nonce.trim()) {
    errors.push("nonce is required");
  }
  if (request.nonce.length > MAX_NONCE_LENGTH) {
    errors.push("nonce exceeds max length");
  }
  if (!requestIdCanonical || !methodCanonical || !chainIdCanonical || !nonceCanonical) {
    errors.push("request identifiers must be canonical (trim-stable)");
  }

  if (request.expiresAtMs <= request.issuedAtMs) {
    errors.push("expiry must be after issuedAt");
  }

  if (request.expiresAtMs - request.issuedAtMs > MAX_TTL_MS) {
    errors.push("ttl exceeds 15 minutes");
  }

  if (request.issuedAtMs - nowMs > MAX_ISSUED_AT_SKEW_MS) {
    errors.push("issuedAt is too far in the future");
  }

  if (isWalletRequestExpired(request, nowMs)) {
    errors.push("request has expired");
  }

  if (!isObjectPayload(request.payload)) {
    errors.push("payload must be an object");
  } else if (Object.keys(request.payload).length === 0) {
    errors.push("payload is required");
  }

  if (!isFiniteIntegerTimestamp(request.issuedAtMs)) {
    errors.push("issuedAt must be a finite integer timestamp");
  }
  if (!isFiniteIntegerTimestamp(request.expiresAtMs)) {
    errors.push("expiresAt must be a finite integer timestamp");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function payloadHash(payload: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function buildApprovalResponse(
  request: WalletRequest,
  decision: ApprovalDecisionInput,
): WalletApprovalResponse {
  if (
    typeof request.requestId !== "string" ||
    typeof request.origin !== "string" ||
    typeof request.method !== "string" ||
    typeof request.chainId !== "string" ||
    typeof request.nonce !== "string"
  ) {
    throw new Error("approval response requires string request envelope fields");
  }
  if (
    request.requestId.trim() !== request.requestId ||
    request.method.trim() !== request.method ||
    request.chainId.trim() !== request.chainId ||
    request.nonce.trim() !== request.nonce ||
    request.origin.trim() !== request.origin
  ) {
    throw new Error("approval response requires canonical request envelope fields");
  }
  if (!request.requestId || request.requestId.length > MAX_REQUEST_ID_LENGTH) {
    throw new Error("approval response requires bounded non-empty requestId");
  }
  if (!request.method || request.method.length > MAX_METHOD_LENGTH) {
    throw new Error("approval response requires bounded non-empty method");
  }
  if (!request.chainId || request.chainId.length > MAX_CHAIN_ID_LENGTH) {
    throw new Error("approval response requires bounded non-empty chainId");
  }
  if (!request.nonce || request.nonce.length > MAX_NONCE_LENGTH) {
    throw new Error("approval response requires bounded non-empty nonce");
  }
  if (
    !request.origin ||
    request.origin.length > MAX_ORIGIN_LENGTH ||
    !isHttpsNonLocalhost(request.origin)
  ) {
    throw new Error("approval response requires https non-localhost bounded origin");
  }
  if (!isObjectPayload(request.payload) || Object.keys(request.payload).length === 0) {
    throw new Error("approval response requires object and non-empty request payload");
  }
  if (
    !isFiniteIntegerTimestamp(request.issuedAtMs) ||
    !isFiniteIntegerTimestamp(request.expiresAtMs)
  ) {
    throw new Error("approval response requires finite integer request timestamps");
  }
  if (request.expiresAtMs <= request.issuedAtMs) {
    throw new Error("approval response requires request expiry after issuedAt");
  }
  if (request.expiresAtMs - request.issuedAtMs > MAX_TTL_MS) {
    throw new Error("approval response requires request ttl within maximum window");
  }
  if (typeof decision.signerAddress !== "string") {
    throw new Error("approval response signerAddress must be a string");
  }
  if (decision.signerAddress.trim() !== decision.signerAddress) {
    throw new Error("approval response signerAddress must be canonical (trim-stable)");
  }
  const normalizedSignerAddress = decision.signerAddress.trim();
  if (!normalizedSignerAddress) {
    throw new Error("approval response requires signerAddress");
  }
  if (normalizedSignerAddress.length > MAX_SIGNER_ADDRESS_LENGTH) {
    throw new Error("approval response signerAddress must be <= 128 chars");
  }
  if (!isFiniteIntegerTimestamp(decision.decidedAtMs)) {
    throw new Error("approval response requires finite integer decidedAtMs");
  }
  if (decision.decidedAtMs < request.issuedAtMs) {
    throw new Error("approval response decidedAtMs cannot be earlier than request issuedAtMs");
  }
  if (decision.decidedAtMs > request.expiresAtMs + MAX_ISSUED_AT_SKEW_MS) {
    throw new Error("approval response decidedAtMs exceeds allowed request decision window");
  }
  if (decision.approved && !decision.signature) {
    throw new Error("approved decision requires signature");
  }
  if (decision.approved && decision.rejectionReason !== undefined) {
    throw new Error("approved decision must not include rejectionReason");
  }
  if (!decision.approved && decision.signature !== undefined) {
    throw new Error("rejected decision must not include signature");
  }
  if (decision.approved && decision.signature !== undefined && typeof decision.signature !== "string") {
    throw new Error("approved decision signature must be a string");
  }
  if (decision.approved && decision.signature && !isValidApprovalSignature(decision.signature)) {
    throw new Error(`approved decision signature must be ${SIGNATURE_HEX_LEN}-char hex`);
  }
  let normalizedRejectionReason: string | undefined;
  if (!decision.approved) {
    const providedReason = decision.rejectionReason;
    if (providedReason !== undefined && typeof providedReason !== "string") {
      throw new Error("rejected decision rejectionReason must be a string");
    }
    if (providedReason !== undefined && providedReason.trim() !== providedReason) {
      throw new Error("rejected decision rejectionReason must be canonical (trim-stable)");
    }
    const candidate = (providedReason ?? "rejected_by_user").trim();
    if (!candidate || candidate.length > MAX_REJECTION_REASON_LENGTH) {
      throw new Error("rejected decision rejectionReason must be non-empty and <= 256 chars");
    }
    normalizedRejectionReason = candidate;
  }
  return {
    requestId: request.requestId,
    chainId: request.chainId,
    nonce: request.nonce,
    origin: request.origin,
    method: request.method,
    payloadHash: payloadHash(request.payload),
    signerAddress: normalizedSignerAddress,
    status: decision.approved ? "approved" : "rejected",
    signature: decision.approved ? decision.signature : undefined,
    rejectionReason: decision.approved ? undefined : normalizedRejectionReason,
    decidedAtMs: decision.decidedAtMs,
  };
}
