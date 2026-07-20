export type UnlockMethod = "passcode" | "biometric";
export type SessionStatus = "locked" | "unlocked";
const MAX_TRUSTED_ORIGINS = 1000;
const MAX_ORIGIN_LENGTH = 2048;
const ALLOWED_UNLOCK_METHODS: UnlockMethod[] = ["passcode", "biometric"];
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const MAX_IDLE_TIMEOUT_MS = 86_400_000;

function isValidTimestamp(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

function isValidUnlockMethod(value: string): value is UnlockMethod {
  return ALLOWED_UNLOCK_METHODS.includes(value as UnlockMethod);
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

export type SessionState = {
  walletId: string;
  accountAddress: string;
  network: string;
  status: SessionStatus;
  unlockMethod: UnlockMethod;
  idleTimeoutMs: number;
  lastActiveAtMs: number;
  trustedOrigins: string[];
};

export function createSession(input: {
  walletId: string;
  accountAddress: string;
  network: string;
  idleTimeoutMs: number;
}): SessionState {
  const idleTimeoutMs =
    Number.isFinite(input.idleTimeoutMs) &&
    Number.isInteger(input.idleTimeoutMs) &&
    input.idleTimeoutMs >= 0 &&
    input.idleTimeoutMs <= MAX_IDLE_TIMEOUT_MS
      ? input.idleTimeoutMs
      : DEFAULT_IDLE_TIMEOUT_MS;
  return {
    walletId: input.walletId,
    accountAddress: input.accountAddress,
    network: input.network,
    status: "locked",
    unlockMethod: "passcode",
    idleTimeoutMs,
    lastActiveAtMs: 0,
    trustedOrigins: [],
  };
}

export function unlockSession(
  session: SessionState,
  input: {
    unlockMethod: UnlockMethod;
    unlockedAtMs: number;
    trustedOrigin?: string;
  },
): SessionState {
  if (!isValidTimestamp(input.unlockedAtMs)) {
    return session;
  }
  if (!isValidUnlockMethod(input.unlockMethod)) {
    return session;
  }

  const trustedOrigins = [...session.trustedOrigins];
  const canonicalOrigin =
    input.trustedOrigin ? canonicalizeTrustedOrigin(input.trustedOrigin) : null;
  if (canonicalOrigin) {
    if (!trustedOrigins.includes(canonicalOrigin)) {
      trustedOrigins.push(canonicalOrigin);
      while (trustedOrigins.length > MAX_TRUSTED_ORIGINS) {
        trustedOrigins.shift();
      }
    }
  }

  return {
    ...session,
    status: "unlocked",
    unlockMethod: input.unlockMethod,
    lastActiveAtMs: input.unlockedAtMs,
    trustedOrigins,
  };
}

export function evaluateSession(session: SessionState, nowMs: number): SessionState {
  if (session.status === "locked") {
    return session;
  }

  if (
    !isValidTimestamp(nowMs) ||
    !isValidTimestamp(session.lastActiveAtMs) ||
    !Number.isFinite(session.idleTimeoutMs) ||
    !Number.isInteger(session.idleTimeoutMs) ||
    session.idleTimeoutMs < 0
  ) {
    return {
      ...session,
      status: "locked",
    };
  }

  if (session.lastActiveAtMs + session.idleTimeoutMs < nowMs) {
    return {
      ...session,
      status: "locked",
    };
  }

  return session;
}

export function isDisallowedHost(rawHostname: string): boolean {
  const hostname = rawHostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }
  if (hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    return false;
  }

  const octets = ipv4.slice(1).map((x) => Number(x));
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }

  if (octets[0] === 10) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return false;
}

export function isTrustedRequestOrigin(origin: string): boolean {
  if (typeof origin !== "string") {
    return false;
  }
  if (origin.length > MAX_ORIGIN_LENGTH) {
    return false;
  }
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") {
      if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1")) {
        return true;
      }
      return false;
    }
    return !isDisallowedHost(parsed.hostname);
  } catch {
    return false;
  }
}
