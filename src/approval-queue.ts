import { createHash, createHmac, timingSafeEqual } from "crypto";
import { isTrustedRequestOrigin } from "./session-runtime";

const MAX_TRACKED_ENTRIES = 1000;
const MAX_REJECTION_REASON_LENGTH = 256;
const MAX_QUEUE_IDENTIFIER_LENGTH = 128;
const MAX_QUEUE_ORIGIN_LENGTH = 2048;
const MAX_SIGNER_ADDRESS_LENGTH = 128;
const MAX_HASH_HEX_LEN = 64;

export type QueueRequest = {
  requestId: string;
  chainId: string;
  nonce: string;
  origin: string;
  method: string;
  payload: Record<string, unknown>;
};

export type QueueDecision = {
  requestId: string;
  chainId: string;
  origin: string;
  method: string;
  payloadHash: string;
  nonce: string;
  status: "approved" | "rejected";
  reason?: string;
  decidedAtMs: number;
};

export type QueueState = {
  pending: QueueRequest[];
  seenRequestIds: Set<string>;
  seenReplayKeys: Set<string>;
  decisions: QueueDecision[];
};

export type SignedDecision = QueueDecision & {
  signerAddress: string;
  signature?: string;
};

export function createApprovalQueue(): QueueState {
  return {
    pending: [],
    seenRequestIds: new Set<string>(),
    seenReplayKeys: new Set<string>(),
    decisions: [],
  };
}

function pruneSet(set: Set<string>): Set<string> {
  while (set.size > MAX_TRACKED_ENTRIES) {
    const oldest = set.values().next().value;
    if (!oldest) break;
    set.delete(oldest);
  }
  return set;
}

function replayKey(request: QueueRequest): string {
  return stableStringify([request.chainId, request.origin, request.method, request.nonce]);
}

function isValidDecisionTime(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

function isValidRejectionReason(reason: string): boolean {
  if (typeof reason !== "string") {
    return false;
  }
  const normalized = reason.trim();
  return normalized.length > 0 && normalized.length <= MAX_REJECTION_REASON_LENGTH;
}

function isObjectPayload(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedCanonicalField(value: string, maxLen: number): boolean {
  return value.trim().length > 0 && value.trim() === value && value.length <= maxLen;
}

function isValidQueueRequest(request: QueueRequest): boolean {
  if (
    typeof request.requestId !== "string" ||
    typeof request.chainId !== "string" ||
    typeof request.method !== "string" ||
    typeof request.nonce !== "string" ||
    typeof request.origin !== "string"
  ) {
    return false;
  }
  if (!isBoundedCanonicalField(request.requestId, MAX_QUEUE_IDENTIFIER_LENGTH)) {
    return false;
  }
  if (!isBoundedCanonicalField(request.chainId, MAX_QUEUE_IDENTIFIER_LENGTH)) {
    return false;
  }
  if (!isBoundedCanonicalField(request.method, MAX_QUEUE_IDENTIFIER_LENGTH)) {
    return false;
  }
  if (!isBoundedCanonicalField(request.nonce, MAX_QUEUE_IDENTIFIER_LENGTH)) {
    return false;
  }
  if (request.origin.length > MAX_QUEUE_ORIGIN_LENGTH || !isTrustedRequestOrigin(request.origin)) {
    return false;
  }
  if (!isObjectPayload(request.payload) || Object.keys(request.payload).length === 0) {
    return false;
  }
  return true;
}

function isValidSignedDecisionEnvelope(decision: QueueDecision): boolean {
  if (
    typeof decision.requestId !== "string" ||
    typeof decision.chainId !== "string" ||
    typeof decision.method !== "string" ||
    typeof decision.nonce !== "string" ||
    typeof decision.origin !== "string" ||
    typeof decision.payloadHash !== "string"
  ) {
    return false;
  }
  if (!isBoundedCanonicalField(decision.requestId, MAX_QUEUE_IDENTIFIER_LENGTH)) {
    return false;
  }
  if (!isBoundedCanonicalField(decision.chainId, MAX_QUEUE_IDENTIFIER_LENGTH)) {
    return false;
  }
  if (!isBoundedCanonicalField(decision.method, MAX_QUEUE_IDENTIFIER_LENGTH)) {
    return false;
  }
  if (!isBoundedCanonicalField(decision.nonce, MAX_QUEUE_IDENTIFIER_LENGTH)) {
    return false;
  }
  if (
    decision.origin.length > MAX_QUEUE_ORIGIN_LENGTH ||
    decision.origin.trim() !== decision.origin ||
    !isTrustedRequestOrigin(decision.origin)
  ) {
    return false;
  }
  if (!/^[a-f0-9]{1,64}$/i.test(decision.payloadHash)) {
    return false;
  }
  if (decision.payloadHash.length > MAX_HASH_HEX_LEN) {
    return false;
  }
  return isValidDecisionTime(decision.decidedAtMs);
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

export function enqueueRequest(state: QueueState, request: QueueRequest): QueueState {
  if (!isValidQueueRequest(request)) {
    return state;
  }
  const key = replayKey(request);
  if (state.seenRequestIds.has(request.requestId) || state.seenReplayKeys.has(key)) {
    return state;
  }

  const nextSeen = new Set(state.seenRequestIds);
  nextSeen.add(request.requestId);
  const nextReplay = new Set(state.seenReplayKeys);
  nextReplay.add(key);
  pruneSet(nextSeen);
  pruneSet(nextReplay);

  return {
    ...state,
    pending: [...state.pending, request].slice(-MAX_TRACKED_ENTRIES),
    seenRequestIds: nextSeen,
    seenReplayKeys: nextReplay,
  };
}

export function dequeueNext(state: QueueState): { state: QueueState; next?: QueueRequest } {
  if (state.pending.length === 0) {
    return { state };
  }
  const [next, ...rest] = state.pending;
  return {
    state: {
      ...state,
      pending: rest,
    },
    next,
  };
}

export function approveRequest(state: QueueState, requestId: string, decidedAtMs: number): QueueState {
  if (!isValidDecisionTime(decidedAtMs)) {
    return state;
  }
  const request = state.pending.find((p) => p.requestId === requestId);
  if (!request) {
    return state;
  }

  const decisions = [
    ...state.decisions,
    {
      requestId,
      chainId: request.chainId,
      origin: request.origin,
      method: request.method,
      payloadHash: payloadHash(request.payload),
      nonce: request.nonce,
      status: "approved" as const,
      decidedAtMs,
    },
  ];

  return {
    ...state,
    pending: state.pending.filter((p) => p.requestId !== requestId),
    decisions: decisions.slice(-MAX_TRACKED_ENTRIES),
  };
}

export function rejectRequest(
  state: QueueState,
  requestId: string,
  reason: string,
  decidedAtMs: number,
): QueueState {
  if (!isValidDecisionTime(decidedAtMs)) {
    return state;
  }
  if (!isValidRejectionReason(reason)) {
    return state;
  }
  const request = state.pending.find((p) => p.requestId === requestId);
  if (!request) {
    return state;
  }

  const decisions = [
    ...state.decisions,
    {
      requestId,
      chainId: request.chainId,
      origin: request.origin,
      method: request.method,
      payloadHash: payloadHash(request.payload),
      nonce: request.nonce,
      status: "rejected" as const,
      reason: reason.trim(),
      decidedAtMs,
    },
  ];

  return {
    ...state,
    pending: state.pending.filter((p) => p.requestId !== requestId),
    decisions: decisions.slice(-MAX_TRACKED_ENTRIES),
  };
}

export function runBackgroundSigner(
  decision: QueueDecision,
  signerAddress: string,
  secret: string,
): SignedDecision {
  if (!secret) {
    throw new Error("missing signer secret");
  }
  if (typeof signerAddress !== "string") {
    throw new Error("signer address must be a string");
  }
  if (!signerAddress.trim()) {
    throw new Error("missing signer address");
  }
  if (signerAddress.trim() !== signerAddress) {
    throw new Error("non-canonical signer address");
  }
  if (signerAddress.length > MAX_SIGNER_ADDRESS_LENGTH) {
    throw new Error("signer address exceeds max length");
  }
  if (!isValidSignedDecisionEnvelope(decision)) {
    throw new Error("invalid decision envelope");
  }

  if (decision.status !== "approved") {
    return {
      ...decision,
      signerAddress,
    };
  }

  return {
    ...decision,
    signerAddress,
    signature: signDecision(decision, signerAddress, secret),
  };
}

function signDecision(decision: QueueDecision, signerAddress: string, secret: string): string {
  const message = `${decision.requestId}|${decision.chainId}|${decision.origin}|${decision.method}|${decision.payloadHash}|${decision.nonce}|${decision.status}|${decision.decidedAtMs}|${signerAddress}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function verifyBackgroundSignature(signed: SignedDecision, secret: string): boolean {
  if (!secret) {
    return false;
  }
  if (typeof signed.signerAddress !== "string") {
    return false;
  }
  if (!signed.signerAddress.trim()) {
    return false;
  }
  if (signed.signerAddress.trim() !== signed.signerAddress) {
    return false;
  }
  if (signed.signerAddress.length > MAX_SIGNER_ADDRESS_LENGTH) {
    return false;
  }
  if (!isValidSignedDecisionEnvelope(signed)) {
    return false;
  }
  if (!signed.signature || signed.status !== "approved") {
    return false;
  }
  if (!/^[a-f0-9]{64}$/i.test(signed.signature)) {
    return false;
  }
  const expectedHex = signDecision(signed, signed.signerAddress, secret);
  const provided = Buffer.from(signed.signature, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
