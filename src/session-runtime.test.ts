import { describe, expect, it } from "bun:test";
import {
  createSession,
  evaluateSession,
  isTrustedRequestOrigin,
  unlockSession,
  type SessionState,
} from "./session-runtime";

const nowMs = 1_700_000_000_000;

describe("session runtime", () => {
  it("creates a locked session by default", () => {
    const session = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: 300_000,
    });

    expect(session.status).toBe("locked");
    expect(session.unlockMethod).toBe("passcode");
  });

  it("fails closed on invalid create-session idle timeout domains", () => {
    const negative = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: -1,
    });
    expect(negative.idleTimeoutMs).toBe(300_000);

    const notInteger = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: 12.5,
    });
    expect(notInteger.idleTimeoutMs).toBe(300_000);

    const tooLarge = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: 99_999_999_999,
    });
    expect(tooLarge.idleTimeoutMs).toBe(300_000);
  });

  it("unlocks with biometric and updates last active timestamp", () => {
    const locked = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: 300_000,
    });

    const unlocked = unlockSession(locked, {
      unlockMethod: "biometric",
      unlockedAtMs: nowMs,
      trustedOrigin: "https://market.sierpinskichain.com",
    });

    expect(unlocked.status).toBe("unlocked");
    expect(unlocked.unlockMethod).toBe("biometric");
    expect(unlocked.lastActiveAtMs).toBe(nowMs);
    expect(unlocked.trustedOrigins).toContain("https://market.sierpinskichain.com");
  });

  it("ignores unlock requests with invalid timestamp domain", () => {
    const locked = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: 300_000,
    });

    const unchanged = unlockSession(locked, {
      unlockMethod: "passcode",
      unlockedAtMs: Number.NaN,
      trustedOrigin: "https://market.sierpinskichain.com",
    });

    expect(unchanged.status).toBe("locked");
    expect(unchanged.lastActiveAtMs).toBe(0);
  });

  it("ignores unlock requests with invalid unlock method domain", () => {
    const locked = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: 300_000,
    });

    const unchanged = unlockSession(locked, {
      unlockMethod: "magic_link" as unknown as "passcode",
      unlockedAtMs: nowMs,
      trustedOrigin: "https://market.sierpinskichain.com",
    });

    expect(unchanged.status).toBe("locked");
    expect(unchanged.unlockMethod).toBe("passcode");
    expect(unchanged.lastActiveAtMs).toBe(0);
  });

  it("caps trusted origin history to bounded entries", () => {
    let session = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: 300_000,
    });

    for (let i = 0; i < 1200; i += 1) {
      session = unlockSession(session, {
        unlockMethod: "passcode",
        unlockedAtMs: nowMs + i,
        trustedOrigin: `https://app${i}.sierpinskichain.com`,
      });
    }

    expect(session.trustedOrigins.length).toBeLessThanOrEqual(1000);
  });

  it("locks session when session timeout domain is invalid", () => {
    const unlocked: SessionState = {
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      status: "unlocked",
      unlockMethod: "passcode",
      idleTimeoutMs: -1,
      lastActiveAtMs: nowMs,
      trustedOrigins: [],
    };

    const evaluated = evaluateSession(unlocked, Number.NaN);
    expect(evaluated.status).toBe("locked");
  });

  it("auto-locks when idle timeout is exceeded", () => {
    const unlocked: SessionState = {
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      status: "unlocked",
      unlockMethod: "passcode",
      idleTimeoutMs: 300_000,
      lastActiveAtMs: nowMs,
      trustedOrigins: [],
    };

    const evaluated = evaluateSession(unlocked, nowMs + 310_000);
    expect(evaluated.status).toBe("locked");
  });

  it("keeps unlocked session active within timeout window", () => {
    const unlocked: SessionState = {
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      status: "unlocked",
      unlockMethod: "passcode",
      idleTimeoutMs: 300_000,
      lastActiveAtMs: nowMs,
      trustedOrigins: [],
    };

    const evaluated = evaluateSession(unlocked, nowMs + 120_000);
    expect(evaluated.status).toBe("unlocked");
  });

  it("trusts only https non-localhost origins", () => {
    expect(isTrustedRequestOrigin("https://market.sierpinskichain.com")).toBe(true);
    expect(isTrustedRequestOrigin("http://market.sierpinskichain.com")).toBe(false);
    expect(isTrustedRequestOrigin("https://localhost:3000")).toBe(false);
    expect(isTrustedRequestOrigin("https://api.localhost")).toBe(false);
    expect(isTrustedRequestOrigin("https://[::1]")).toBe(false);
    expect(isTrustedRequestOrigin("https://10.1.2.3")).toBe(false);
    expect(isTrustedRequestOrigin("https://192.168.1.20")).toBe(false);
    const oversizedOrigin = `https://${"a".repeat(2100)}.sierpinskichain.com`;
    expect(isTrustedRequestOrigin(oversizedOrigin)).toBe(false);
  });

  it("does not persist oversized trustedOrigin values during unlock", () => {
    const locked = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: 300_000,
    });

    const oversizedOrigin = `https://${"a".repeat(2100)}.sierpinskichain.com`;
    const unlocked = unlockSession(locked, {
      unlockMethod: "passcode",
      unlockedAtMs: nowMs,
      trustedOrigin: oversizedOrigin,
    });

    expect(unlocked.trustedOrigins).toEqual([]);
  });

  it("normalizes trustedOrigin to canonical URL origin during unlock", () => {
    const locked = createSession({
      walletId: "wallet_1",
      accountAddress: "hisham.spc",
      network: "sierpinski-testnet-1",
      idleTimeoutMs: 300_000,
    });

    const unlocked = unlockSession(locked, {
      unlockMethod: "passcode",
      unlockedAtMs: nowMs,
      trustedOrigin: "https://market.sierpinskichain.com/checkout?step=1",
    });
    expect(unlocked.trustedOrigins).toEqual(["https://market.sierpinskichain.com"]);
  });
});
