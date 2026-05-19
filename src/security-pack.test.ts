import { describe, expect, it } from "bun:test";
import { runSecurityPack } from "./security-pack";

describe("triwallet security pack", () => {
  it("flags phishing for non-https/local origins", () => {
    const report = runSecurityPack({
      requestOrigin: "http://localhost:3000",
      requestId: "req_1",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "100",
      knownRequestIds: [],
      knownReplayKeys: [],
      knownAccounts: ["hisham.spc"],
      exposedAccounts: ["hisham.spc"],
      unlockAttempts: 3,
      maxUnlockAttempts: 5,
    });
    expect(report.phishingResistant).toBe(false);
  });

  it("flags replay when request id was already processed", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "req_1",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "100",
      knownRequestIds: ["req_1"],
      knownReplayKeys: [],
      knownAccounts: ["hisham.spc"],
      exposedAccounts: ["hisham.spc"],
      unlockAttempts: 1,
      maxUnlockAttempts: 5,
    });
    expect(report.replayProtected).toBe(false);
  });

  it("flags replay when tuple was already processed", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "req_2",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "100",
      knownRequestIds: [],
      knownReplayKeys: ["[\"sierpinski-testnet-1\",\"https://market.sierpinskichain.com\",\"sendTransaction\",\"100\"]"],
      knownAccounts: ["hisham.spc"],
      exposedAccounts: ["hisham.spc"],
      unlockAttempts: 1,
      maxUnlockAttempts: 5,
    });
    expect(report.replayProtected).toBe(false);
  });

  it("flags permission boundary breach when unknown account is exposed", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "req_2",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "101",
      knownRequestIds: [],
      knownReplayKeys: [],
      knownAccounts: ["hisham.spc"],
      exposedAccounts: ["ops.spc"],
      unlockAttempts: 1,
      maxUnlockAttempts: 5,
    });
    expect(report.permissionsBounded).toBe(false);
  });

  it("fails closed on oversized permission scope input collections", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "req_scope_oversized",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "100",
      knownRequestIds: [],
      knownReplayKeys: [],
      knownAccounts: Array.from({ length: 2000 }, (_, i) => `acct_${i}.spc`),
      exposedAccounts: Array.from({ length: 2000 }, (_, i) => `acct_${i}.spc`),
      unlockAttempts: 1,
      maxUnlockAttempts: 5,
    });
    expect(report.permissionsBounded).toBe(false);
    expect(report.findings).toContain("permission_scope_input_oversized");
  });

  it("flags unlock abuse when attempts exceed threshold", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "req_3",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "102",
      knownRequestIds: [],
      knownReplayKeys: [],
      knownAccounts: ["hisham.spc"],
      exposedAccounts: ["hisham.spc"],
      unlockAttempts: 7,
      maxUnlockAttempts: 5,
    });
    expect(report.unlockAbuseResistant).toBe(false);
  });

  it("flags invalid unlock counter domains", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "req_3",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "102",
      knownRequestIds: [],
      knownReplayKeys: [],
      knownAccounts: ["hisham.spc"],
      exposedAccounts: ["hisham.spc"],
      unlockAttempts: -1,
      maxUnlockAttempts: -5,
    });
    expect(report.unlockAbuseResistant).toBe(false);
    expect(report.findings).toContain("unlock_attempts_invalid_domain");
  });

  it("flags invalid replay identifier domains", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "   ",
      chainId: " ",
      method: "",
      nonce: "",
      knownRequestIds: [],
      knownReplayKeys: [],
      knownAccounts: ["hisham.spc"],
      exposedAccounts: ["hisham.spc"],
      unlockAttempts: 1,
      maxUnlockAttempts: 5,
    });
    expect(report.replayProtected).toBe(false);
    expect(report.findings).toContain("replay_identifier_invalid_domain");
  });

  it("flags oversized replay identifier domains", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "r".repeat(200),
      chainId: "c".repeat(200),
      method: "m".repeat(200),
      nonce: "n".repeat(200),
      knownRequestIds: [],
      knownReplayKeys: [],
      knownAccounts: ["hisham.spc"],
      exposedAccounts: ["hisham.spc"],
      unlockAttempts: 1,
      maxUnlockAttempts: 5,
    });
    expect(report.replayProtected).toBe(false);
    expect(report.findings).toContain("replay_identifier_invalid_domain");
  });

  it("fails closed on non-canonical replay identifier whitespace variants", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "req_4 ",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "103",
      knownRequestIds: ["req_4"],
      knownReplayKeys: [],
      knownAccounts: ["hisham.spc", "ops.spc"],
      exposedAccounts: ["hisham.spc"],
      unlockAttempts: 1,
      maxUnlockAttempts: 5,
    });
    expect(report.replayProtected).toBe(false);
    expect(report.findings).toContain("replay_identifier_invalid_domain");
  });

  it("passes all checks for healthy scenario", () => {
    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "req_4",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "103",
      knownRequestIds: [],
      knownReplayKeys: [],
      knownAccounts: ["hisham.spc", "ops.spc"],
      exposedAccounts: ["hisham.spc"],
      unlockAttempts: 1,
      maxUnlockAttempts: 5,
    });
    expect(report.pass).toBe(true);
  });

  it("fails closed without throwing on non-array collection domains", () => {
    expect(() =>
      runSecurityPack({
        requestOrigin: "https://market.sierpinskichain.com",
        requestId: "req_shape",
        chainId: "sierpinski-testnet-1",
        method: "sendTransaction",
        nonce: "shape_1",
        knownRequestIds: null as unknown as string[],
        knownReplayKeys: {} as unknown as string[],
        knownAccounts: "hisham.spc" as unknown as string[],
        exposedAccounts: null as unknown as string[],
        unlockAttempts: 1,
        maxUnlockAttempts: 5,
      }),
    ).not.toThrow();

    const report = runSecurityPack({
      requestOrigin: "https://market.sierpinskichain.com",
      requestId: "req_shape",
      chainId: "sierpinski-testnet-1",
      method: "sendTransaction",
      nonce: "shape_1",
      knownRequestIds: null as unknown as string[],
      knownReplayKeys: {} as unknown as string[],
      knownAccounts: "hisham.spc" as unknown as string[],
      exposedAccounts: null as unknown as string[],
      unlockAttempts: 1,
      maxUnlockAttempts: 5,
    });
    expect(report.pass).toBe(false);
  });
});
