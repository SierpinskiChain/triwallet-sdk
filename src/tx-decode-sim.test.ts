import { describe, expect, it } from "bun:test";
import {
  decodeWalletRequestIntent,
  simulateWalletRequest,
  type WalletRequestSimulationInput,
} from "./tx-decode-sim";

const input: WalletRequestSimulationInput = {
  accountAddress: "hisham.spc",
  balanceAtomic: 125_000,
  request: {
    requestId: "req_123",
    origin: "https://market.sierpinskichain.com",
    method: "sendTransaction",
    chainId: "sierpinski-testnet-1",
    nonce: "87221",
    issuedAtMs: 1_700_000_000_000,
    expiresAtMs: 1_700_000_090_000,
    payload: {
      to: "merchant.spc",
      amount: "1840",
      asset: "SPC",
      memo: "escrow release",
    },
  },
};

describe("tx decode + simulation", () => {
  it("decodes request to human-readable intent", () => {
    const decoded = decodeWalletRequestIntent(input.request);
    expect(decoded.intentTitle).toContain("Send");
    expect(decoded.to).toBe("merchant.spc");
    expect(decoded.amountAtomic).toBe(1840n);
  });

  it("treats malformed amount payload as zero and emits parse risk flag", () => {
    const sim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        payload: {
          ...input.request.payload,
          amount: "1e9",
        },
      },
    });
    expect(sim.amountAtomic).toBe(0n);
    expect(sim.riskFlags).toContain("invalid_amount");
  });

  it("fails closed on negative amount payloads and emits domain risk flag", () => {
    const sim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        payload: {
          ...input.request.payload,
          amount: "-12",
        },
      },
    });
    expect(sim.amountAtomic).toBe(0n);
    expect(sim.riskFlags).toContain("invalid_amount_domain");
  });

  it("fails closed on oversized amount payloads and emits length risk flag", () => {
    const sim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        payload: {
          ...input.request.payload,
          amount: "9".repeat(4096),
        },
      },
    });
    expect(sim.amountAtomic).toBe(0n);
    expect(sim.riskFlags).toContain("invalid_amount_length");
  });

  it("fails closed on oversized asset/memo payloads and emits length risk flags", () => {
    const sim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        payload: {
          ...input.request.payload,
          asset: "S".repeat(1024),
          memo: "m".repeat(10_000),
        },
      },
    });
    const decoded = decodeWalletRequestIntent({
      ...input.request,
      payload: {
        ...input.request.payload,
        asset: "S".repeat(1024),
        memo: "m".repeat(10_000),
      },
    });
    expect(decoded.asset).toBe("SPC");
    expect(decoded.memo).toBeUndefined();
    expect(sim.riskFlags).toContain("invalid_asset_length");
    expect(sim.riskFlags).toContain("invalid_memo_length");
  });

  it("simulates post-state with fee and balance delta", () => {
    const sim = simulateWalletRequest(input);
    expect(sim.feeAtomic).toBeGreaterThan(0n);
    expect(sim.balanceDeltaAtomic).toBeLessThan(0n);
    expect(sim.postBalanceAtomic).toBe(BigInt(input.balanceAtomic) - (sim.amountAtomic + sim.feeAtomic));
  });

  it("flags high amount and unknown method risks", () => {
    const highAmountSim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        payload: {
          ...input.request.payload,
          amount: "75000",
        },
      },
    });
    expect(highAmountSim.riskFlags).toContain("high_amount");

    const unknownMethodSim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        method: "vendor.customCall",
      },
    });
    expect(unknownMethodSim.riskFlags).toContain("unknown_method");
  });

  it("flags insufficient funds", () => {
    const sim = simulateWalletRequest({
      ...input,
      balanceAtomic: 100,
    });
    expect(sim.riskFlags).toContain("insufficient_funds");
  });

  it("fails closed on invalid balanceAtomic domain without throwing", () => {
    const sim = simulateWalletRequest({
      ...input,
      balanceAtomic: Number.NaN,
    });
    expect(sim.riskFlags).toContain("invalid_balance_domain");
    expect(sim.postBalanceAtomic).toBeLessThanOrEqual(0n);
  });

  it("flags invalid accountAddress domain", () => {
    const sim = simulateWalletRequest({
      ...input,
      accountAddress: "   ",
    });
    expect(sim.riskFlags).toContain("invalid_account_address_domain");
  });

  it("fails closed on unsafe-integer balance domain without throwing", () => {
    const unsafeInput = {
      ...input,
      balanceAtomic: Number.MAX_SAFE_INTEGER + 1,
    };
    const sim = simulateWalletRequest(unsafeInput);
    expect(sim.postBalanceAtomic).toBe(-(sim.amountAtomic + sim.feeAtomic));
    expect(sim.riskFlags).toContain("invalid_balance_domain");
  });

  it("flags oversized accountAddress domain", () => {
    const sim = simulateWalletRequest({
      ...input,
      accountAddress: "a".repeat(300),
    });
    expect(sim.riskFlags).toContain("invalid_account_address_domain");
  });

  it("flags non-canonical accountAddress whitespace variants", () => {
    const sim = simulateWalletRequest({
      ...input,
      accountAddress: " hisham.spc",
    });
    expect(sim.riskFlags).toContain("invalid_account_address_domain");
  });

  it("flags oversized request.origin domain", () => {
    const sim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        origin: `https://${"o".repeat(300)}.example`,
      },
    });
    expect(sim.riskFlags).toContain("invalid_request_origin_domain");
  });

  it("flags non-canonical request.origin whitespace variants", () => {
    const sim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        origin: " https://market.sierpinskichain.com",
      },
    });
    expect(sim.riskFlags).toContain("invalid_request_origin_domain");
  });

  it("flags oversized transaction recipient domain", () => {
    const sim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        payload: {
          ...input.request.payload,
          to: "a".repeat(300),
        },
      },
    });
    expect(sim.riskFlags).toContain("invalid_recipient_domain");
  });

  it("flags non-canonical transaction recipient whitespace variants", () => {
    const sim = simulateWalletRequest({
      ...input,
      request: {
        ...input.request,
        payload: {
          ...input.request.payload,
          to: " merchant.spc",
        },
      },
    });
    expect(sim.riskFlags).toContain("invalid_recipient_domain");
  });

  it("fails closed on non-string account/origin domains without throwing", () => {
    const sim = simulateWalletRequest({
      ...(input as unknown as Record<string, unknown>),
      accountAddress: 42,
      request: {
        ...input.request,
        origin: { host: "market.sierpinskichain.com" },
      },
    } as unknown as WalletRequestSimulationInput);
    expect(sim.riskFlags).toContain("invalid_account_address_domain");
    expect(sim.riskFlags).toContain("invalid_request_origin_domain");
  });

  it("fails closed on non-object request payload domain without throwing", () => {
    const decoded = decodeWalletRequestIntent({
      ...input.request,
      payload: null as unknown as Record<string, unknown>,
    });
    expect(decoded.amountAtomic).toBe(0n);
    expect(decoded.asset).toBe("SPC");
    expect(decoded.to).toBe("unknown.spc");
  });
});
