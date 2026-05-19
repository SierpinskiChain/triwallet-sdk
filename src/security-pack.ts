import { isTrustedRequestOrigin } from "./session-runtime";

const MAX_REPLAY_IDENTIFIER_LENGTH = 128;
const MAX_PERMISSION_SCOPE_ENTRIES = 1000;

export type SecurityPackInput = {
  requestOrigin: string;
  requestId: string;
  chainId: string;
  method: string;
  nonce: string;
  knownRequestIds: string[];
  knownReplayKeys: string[];
  knownAccounts: string[];
  exposedAccounts: string[];
  unlockAttempts: number;
  maxUnlockAttempts: number;
};

export type SecurityPackReport = {
  phishingResistant: boolean;
  replayProtected: boolean;
  permissionsBounded: boolean;
  unlockAbuseResistant: boolean;
  findings: string[];
  pass: boolean;
};

function replayTuple(input: SecurityPackInput): string {
  return JSON.stringify([input.chainId, input.requestOrigin, input.method, input.nonce]);
}

export function runSecurityPack(input: SecurityPackInput): SecurityPackReport {
  const findings: string[] = [];
  const collectionDomainsValid =
    Array.isArray(input.knownRequestIds) &&
    Array.isArray(input.knownReplayKeys) &&
    Array.isArray(input.knownAccounts) &&
    Array.isArray(input.exposedAccounts);
  const replayIdentifierDomainsValid =
    typeof input.requestId === "string" &&
    typeof input.chainId === "string" &&
    typeof input.method === "string" &&
    typeof input.nonce === "string";
  if (!collectionDomainsValid || !replayIdentifierDomainsValid) {
    return {
      phishingResistant: false,
      replayProtected: false,
      permissionsBounded: false,
      unlockAbuseResistant: false,
      findings: ["input_domain_invalid"],
      pass: false,
    };
  }
  const normalizedRequestId = input.requestId.trim();
  const normalizedChainId = input.chainId.trim();
  const normalizedMethod = input.method.trim();
  const normalizedNonce = input.nonce.trim();
  const identifiersCanonical =
    normalizedRequestId === input.requestId &&
    normalizedChainId === input.chainId &&
    normalizedMethod === input.method &&
    normalizedNonce === input.nonce;
  const identifiersWithinBounds =
    normalizedRequestId.length <= MAX_REPLAY_IDENTIFIER_LENGTH &&
    normalizedChainId.length <= MAX_REPLAY_IDENTIFIER_LENGTH &&
    normalizedMethod.length <= MAX_REPLAY_IDENTIFIER_LENGTH &&
    normalizedNonce.length <= MAX_REPLAY_IDENTIFIER_LENGTH;
  const replayIdentifiersValid =
    identifiersCanonical &&
    identifiersWithinBounds &&
    normalizedRequestId.length > 0 &&
    normalizedChainId.length > 0 &&
    normalizedMethod.length > 0 &&
    normalizedNonce.length > 0;

  const normalizedReplayTuple = replayTuple({
    ...input,
    requestId: normalizedRequestId,
    chainId: normalizedChainId,
    method: normalizedMethod,
    nonce: normalizedNonce,
  });

  const phishingResistant = isTrustedRequestOrigin(input.requestOrigin);
  if (!phishingResistant) {
    findings.push("phishing_origin_untrusted");
  }

  const replayProtected =
    replayIdentifiersValid &&
    !input.knownRequestIds.includes(normalizedRequestId) &&
    !input.knownReplayKeys.includes(normalizedReplayTuple);
  if (!replayProtected) {
    if (!replayIdentifiersValid) {
      findings.push("replay_identifier_invalid_domain");
    }
    findings.push("replay_request_seen");
  }

  const permissionsBounded = input.exposedAccounts.every((account) =>
    input.knownAccounts.includes(account),
  );
  const permissionScopeCollectionsWithinBounds =
    input.knownAccounts.length <= MAX_PERMISSION_SCOPE_ENTRIES &&
    input.exposedAccounts.length <= MAX_PERMISSION_SCOPE_ENTRIES;
  const permissionScopeOk = permissionScopeCollectionsWithinBounds && permissionsBounded;
  if (!permissionScopeCollectionsWithinBounds) {
    findings.push("permission_scope_input_oversized");
  }
  if (!permissionScopeOk) {
    findings.push("permission_scope_breach");
  }

  const countersAreValid =
    Number.isFinite(input.unlockAttempts) &&
    Number.isInteger(input.unlockAttempts) &&
    Number.isFinite(input.maxUnlockAttempts) &&
    Number.isInteger(input.maxUnlockAttempts) &&
    input.unlockAttempts >= 0 &&
    input.maxUnlockAttempts >= 0;
  const unlockAbuseResistant = countersAreValid && input.unlockAttempts <= input.maxUnlockAttempts;
  if (!countersAreValid) {
    findings.push("unlock_attempts_invalid_domain");
  } else if (!unlockAbuseResistant) {
    findings.push("unlock_attempts_exceeded");
  }

  return {
    phishingResistant,
    replayProtected,
    permissionsBounded: permissionScopeOk,
    unlockAbuseResistant,
    findings,
    pass:
      phishingResistant && replayProtected && permissionScopeOk && unlockAbuseResistant,
  };
}
