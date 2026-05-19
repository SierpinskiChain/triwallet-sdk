import { isTrustedRequestOrigin } from "./session-runtime";

const MAX_AUDIT_ENTRIES = 1000;
const MAX_CONSENT_ORIGINS = 1000;
const MAX_CONNECT_COLLECTION_SIZE = 256;
const MAX_ACCOUNT_ID_LENGTH = 128;
const MAX_PERMISSION_ID_LENGTH = 64;
const MAX_AUDIT_ORIGIN_LENGTH = 256;
const INVALID_AUDIT_ORIGIN = "[invalid_origin]";
const ALLOWED_PERMISSIONS = new Set([
  "read_balance",
  "request_signature",
  "send_transaction",
  "read_activity",
]);

export type DappConsent = {
  origin: string;
  exposedAccounts: string[];
  permissions: string[];
  updatedAtMs: number;
};

export type DappPermissionRequest = {
  origin: string;
  walletAccounts: string[];
  exposeAccounts: string[];
  permissions: string[];
  nowMs: number;
};

export type ConsentAudit = {
  origin: string;
  action: "connect" | "revoke" | "reject_untrusted_origin";
  atMs: number;
};

export type PermissionsState = {
  byOrigin: Record<string, DappConsent>;
  auditTrail: ConsentAudit[];
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function pruneAuditTrail(auditTrail: ConsentAudit[]): ConsentAudit[] {
  if (auditTrail.length <= MAX_AUDIT_ENTRIES) {
    return auditTrail;
  }
  return auditTrail.slice(-MAX_AUDIT_ENTRIES);
}

function isValidTimestamp(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

function isValidAccountIdentifier(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return value.trim().length > 0 && value.trim() === value && value.length <= MAX_ACCOUNT_ID_LENGTH;
}

function isValidPermissionIdentifier(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return (
    value.trim().length > 0 &&
    value.trim() === value &&
    value.length <= MAX_PERMISSION_ID_LENGTH
  );
}

function canonicalizeTrustedOrigin(origin: string): string | null {
  if (!isTrustedRequestOrigin(origin)) {
    return null;
  }
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function toSafeAuditOrigin(origin: unknown): string {
  if (typeof origin !== "string") {
    return INVALID_AUDIT_ORIGIN;
  }
  const trimmed = origin.trim();
  if (trimmed.length === 0) {
    return INVALID_AUDIT_ORIGIN;
  }
  try {
    const canonicalOrigin = new URL(trimmed).origin;
    if (canonicalOrigin.length > MAX_AUDIT_ORIGIN_LENGTH) {
      return canonicalOrigin.slice(0, MAX_AUDIT_ORIGIN_LENGTH);
    }
    return canonicalOrigin;
  } catch {
    if (trimmed.length > MAX_AUDIT_ORIGIN_LENGTH) {
      return trimmed.slice(0, MAX_AUDIT_ORIGIN_LENGTH);
    }
    return trimmed;
  }
}

export function createPermissionsState(): PermissionsState {
  return { byOrigin: {}, auditTrail: [] };
}

export function connectDapp(
  state: PermissionsState,
  request: DappPermissionRequest,
): PermissionsState {
  if (!isValidTimestamp(request.nowMs)) {
    return state;
  }
  const collectionsAreArrays =
    Array.isArray(request.walletAccounts) &&
    Array.isArray(request.exposeAccounts) &&
    Array.isArray(request.permissions);
  if (!collectionsAreArrays) {
    return {
      ...state,
      auditTrail: pruneAuditTrail([
        ...state.auditTrail,
        {
          origin: toSafeAuditOrigin(request.origin),
          action: "reject_untrusted_origin",
          atMs: request.nowMs,
        },
      ]),
    };
  }
  const collectionsWithinBounds =
    request.walletAccounts.length <= MAX_CONNECT_COLLECTION_SIZE &&
    request.exposeAccounts.length <= MAX_CONNECT_COLLECTION_SIZE &&
    request.permissions.length <= MAX_CONNECT_COLLECTION_SIZE;
  if (!collectionsWithinBounds) {
    return {
      ...state,
      auditTrail: pruneAuditTrail([
        ...state.auditTrail,
        {
          origin: toSafeAuditOrigin(request.origin),
          action: "reject_untrusted_origin",
          atMs: request.nowMs,
        },
      ]),
    };
  }
  const accountEntriesAreValid =
    request.walletAccounts.every(isValidAccountIdentifier) &&
    request.exposeAccounts.every(isValidAccountIdentifier);
  const permissionEntriesAreValid = request.permissions.every(isValidPermissionIdentifier);
  if (!accountEntriesAreValid || !permissionEntriesAreValid) {
    return {
      ...state,
      auditTrail: pruneAuditTrail([
        ...state.auditTrail,
        {
          origin: toSafeAuditOrigin(request.origin),
          action: "reject_untrusted_origin",
          atMs: request.nowMs,
        },
      ]),
    };
  }
  const canonicalOrigin = canonicalizeTrustedOrigin(request.origin);
  if (!canonicalOrigin) {
    return {
      ...state,
      auditTrail: pruneAuditTrail([
        ...state.auditTrail,
        {
          origin: toSafeAuditOrigin(request.origin),
          action: "reject_untrusted_origin",
          atMs: request.nowMs,
        },
      ]),
    };
  }

  const allowed = request.exposeAccounts.filter((a) => request.walletAccounts.includes(a));
  const allowedPermissions = request.permissions.filter((perm) =>
    ALLOWED_PERMISSIONS.has(perm),
  );
  const consent: DappConsent = {
    origin: canonicalOrigin,
    exposedAccounts: unique(allowed),
    permissions: unique(allowedPermissions),
    updatedAtMs: request.nowMs,
  };

  const byOrigin = {
    ...state.byOrigin,
    [canonicalOrigin]: consent,
  };

  const entries = Object.entries(byOrigin);
  if (entries.length > MAX_CONSENT_ORIGINS) {
    entries.sort((a, b) => a[1].updatedAtMs - b[1].updatedAtMs);
    const dropCount = entries.length - MAX_CONSENT_ORIGINS;
    for (let i = 0; i < dropCount; i += 1) {
      const oldestOrigin = entries[i]?.[0];
      if (oldestOrigin) {
        delete byOrigin[oldestOrigin];
      }
    }
  }

  return {
    byOrigin,
    auditTrail: pruneAuditTrail([
      ...state.auditTrail,
      { origin: canonicalOrigin, action: "connect", atMs: request.nowMs },
    ]),
  };
}

export function revokeOrigin(state: PermissionsState, origin: string, nowMs: number): PermissionsState {
  if (!isValidTimestamp(nowMs)) {
    return state;
  }
  const canonicalOrigin = canonicalizeTrustedOrigin(origin);
  if (!canonicalOrigin) {
    return state;
  }
  const next = { ...state.byOrigin };
  delete next[canonicalOrigin];
  return {
    byOrigin: next,
    auditTrail: pruneAuditTrail([
      ...state.auditTrail,
      { origin: canonicalOrigin, action: "revoke", atMs: nowMs },
    ]),
  };
}

export function listOriginConsents(state: PermissionsState): DappConsent[] {
  return Object.values(state.byOrigin).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}
