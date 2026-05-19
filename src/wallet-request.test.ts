import { describe, expect, it } from "bun:test";
import {
  buildApprovalResponse,
  isWalletRequestExpired,
  validateWalletRequest,
  type WalletRequest,
} from "./wallet-request";

const now = 1_700_000_000_000;

function baseRequest(overrides: Partial<WalletRequest> = {}): WalletRequest {
  return {
    requestId: "req_123",
    origin: "https://market.sierpinskichain.com",
    method: "sendTransaction",
    chainId: "sierpinski-testnet-1",
    nonce: "87221",
    issuedAtMs: now,
    expiresAtMs: now + 60_000,
    payload: {
      from: "hisham.spc",
      to: "merchant.spc",
      amount: "1840",
      asset: "SPC",
    },
    ...overrides,
  };
}

describe("wallet request protocol", () => {
  it("accepts a valid wallet request envelope", () => {
    const result = validateWalletRequest(baseRequest(), now + 1_000);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects invalid origin and empty method", () => {
    const result = validateWalletRequest(
      baseRequest({ origin: "http://localhost:3000", method: "" }),
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("origin must be https and non-localhost");
    expect(result.errors).toContain("method is required");
  });

  it("rejects loopback/private-network origin variants", () => {
    expect(validateWalletRequest(baseRequest({ origin: "https://[::1]" }), now).ok).toBe(false);
    expect(validateWalletRequest(baseRequest({ origin: "https://10.0.0.12" }), now).ok).toBe(false);
    expect(validateWalletRequest(baseRequest({ origin: "https://dev.localhost" }), now).ok).toBe(false);
  });

  it("flags expiry and excessive ttl", () => {
    const expired = validateWalletRequest(baseRequest({ expiresAtMs: now - 1 }), now);
    expect(expired.ok).toBe(false);
    expect(expired.errors).toContain("request has expired");

    const longTtl = validateWalletRequest(baseRequest({ expiresAtMs: now + 16 * 60_000 }), now);
    expect(longTtl.ok).toBe(false);
    expect(longTtl.errors).toContain("ttl exceeds 15 minutes");
  });

  it("rejects request issued too far in the future", () => {
    const result = validateWalletRequest(baseRequest({ issuedAtMs: now + 90_000, expiresAtMs: now + 120_000 }), now);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("issuedAt is too far in the future");
  });

  it("rejects non-finite timestamp fields", () => {
    const badIssued = validateWalletRequest(baseRequest({ issuedAtMs: Number.NaN }), now);
    expect(badIssued.ok).toBe(false);
    expect(badIssued.errors).toContain("issuedAt must be a finite integer timestamp");

    const badExpiry = validateWalletRequest(baseRequest({ expiresAtMs: Number.POSITIVE_INFINITY }), now);
    expect(badExpiry.ok).toBe(false);
    expect(badExpiry.errors).toContain("expiresAt must be a finite integer timestamp");
  });

  it("rejects non-object payload domains without throwing", () => {
    const nullPayload = validateWalletRequest(
      baseRequest({ payload: null as unknown as Record<string, unknown> }),
      now,
    );
    expect(nullPayload.ok).toBe(false);
    expect(nullPayload.errors).toContain("payload must be an object");

    const arrayPayload = validateWalletRequest(
      baseRequest({ payload: [] as unknown as Record<string, unknown> }),
      now,
    );
    expect(arrayPayload.ok).toBe(false);
    expect(arrayPayload.errors).toContain("payload must be an object");
  });

  it("rejects non-string request envelope fields without throwing", () => {
    const malformed = {
      ...baseRequest(),
      requestId: 123,
      origin: { url: "https://wallet.sierpinskichain.com" },
      method: false,
      chainId: null,
      nonce: ["n1"],
    } as unknown as WalletRequest;

    const validation = validateWalletRequest(malformed, now);
    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("request envelope fields must be strings");
  });

  it("rejects non-object request envelope input without throwing", () => {
    const validation = validateWalletRequest(null as unknown as WalletRequest, now);
    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("request envelope object is required");
  });

  it("rejects invalid nowMs validation clock domains", () => {
    const badNowNaN = validateWalletRequest(baseRequest(), Number.NaN);
    expect(badNowNaN.ok).toBe(false);
    expect(badNowNaN.errors).toContain("validation nowMs must be a finite integer timestamp");

    const badNowInf = validateWalletRequest(baseRequest(), Number.POSITIVE_INFINITY);
    expect(badNowInf.ok).toBe(false);
    expect(badNowInf.errors).toContain("validation nowMs must be a finite integer timestamp");
  });

  it("rejects oversized request envelope fields", () => {
    const result = validateWalletRequest(
      baseRequest({
        requestId: "r".repeat(200),
        method: "m".repeat(80),
        nonce: "n".repeat(200),
      }),
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("requestId exceeds max length");
    expect(result.errors).toContain("method exceeds max length");
    expect(result.errors).toContain("nonce exceeds max length");
  });

  it("rejects non-canonical identifier whitespace variants", () => {
    const result = validateWalletRequest(
      baseRequest({
        requestId: "req_123 ",
        method: " sendTransaction",
        chainId: "sierpinski-testnet-1 ",
        nonce: " 87221",
      }),
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("request identifiers must be canonical (trim-stable)");
  });

  it("rejects non-canonical origin whitespace variants", () => {
    const result = validateWalletRequest(
      baseRequest({
        origin: " https://market.sierpinskichain.com",
      }),
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("origin must be canonical (trim-stable)");
  });

  it("builds approval response preserving replay-safe identifiers", () => {
    const request = baseRequest();
    const response = buildApprovalResponse(request, {
      approved: true,
      signerAddress: "hisham.spc",
      signature: "b".repeat(64),
      decidedAtMs: now + 2_000,
    });

    expect(response.requestId).toBe(request.requestId);
    expect(response.nonce).toBe(request.nonce);
    expect(response.signature).toBe("b".repeat(64));
    expect(response.status).toBe("approved");
  });

  it("throws when building approval response with non-canonical request envelope identifiers", () => {
    const request = baseRequest({ nonce: " 87221" });
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "b".repeat(64),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building approval response with non-object request payload domain", () => {
    const request = baseRequest({ payload: [] as unknown as Record<string, unknown> });
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "b".repeat(64),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building approval response with invalid request timestamp domains", () => {
    const request = baseRequest({ issuedAtMs: Number.NaN });
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "b".repeat(64),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building approval response with invalid request temporal order", () => {
    const request = baseRequest({ issuedAtMs: now + 10_000, expiresAtMs: now + 9_000 });
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "b".repeat(64),
        decidedAtMs: now + 10_500,
      }),
    ).toThrow();
  });

  it("throws when building approval response with malformed request envelope domains", () => {
    const request = baseRequest({
      method: "",
      origin: "http://localhost:3000",
    });
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "b".repeat(64),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws controlled error when building approval response with non-string request envelope domains", () => {
    const request = baseRequest({
      requestId: 1 as unknown as string,
      origin: {} as unknown as string,
      method: true as unknown as string,
      chainId: null as unknown as string,
      nonce: [] as unknown as string,
    });
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "b".repeat(64),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow("approval response requires string request envelope fields");
  });

  it("throws when building approved response without signature", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building approved response with malformed signature", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "0xabc123",
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building approved response with non-string signature domain", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: 123 as unknown as string,
        decidedAtMs: now + 2_000,
      }),
    ).toThrow("approved decision signature must be a string");
  });

  it("throws when building approved response with unexpected rejectionReason material", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "a".repeat(64),
        rejectionReason: "user_rejected",
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building response with empty signer address", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: false,
        signerAddress: "   ",
        rejectionReason: "user_rejected",
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws controlled errors for non-string decision signer/rejection domains", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: 123 as unknown as string,
        signature: "a".repeat(64),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow("approval response signerAddress must be a string");

    expect(() =>
      buildApprovalResponse(request, {
        approved: false,
        signerAddress: "hisham.spc",
        rejectionReason: 1 as unknown as string,
        decidedAtMs: now + 2_000,
      }),
    ).toThrow("rejected decision rejectionReason must be a string");
  });

  it("throws when building response with non-canonical signer address whitespace variants", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: " hisham.spc",
        signature: "a".repeat(64),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building response with oversized signer address", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "s".repeat(1024),
        signature: "a".repeat(64),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building response with invalid decidedAt timestamp", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "a".repeat(64),
        decidedAtMs: Number.NaN,
      }),
    ).toThrow();
  });

  it("throws when building response with decidedAt before request issuedAt", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "a".repeat(64),
        decidedAtMs: request.issuedAtMs - 1,
      }),
    ).toThrow();
  });

  it("throws when building response with decidedAt after expiry skew allowance", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "hisham.spc",
        signature: "a".repeat(64),
        decidedAtMs: request.expiresAtMs + 60_001,
      }),
    ).toThrow();
  });

  it("throws when building rejected response with malformed rejectionReason domain", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: false,
        signerAddress: "hisham.spc",
        rejectionReason: "   ",
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building rejected response with unexpected signature material", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: false,
        signerAddress: "hisham.spc",
        signature: "a".repeat(64),
        rejectionReason: "user_rejected",
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building rejected response with non-canonical rejectionReason whitespace variants", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: false,
        signerAddress: "hisham.spc",
        rejectionReason: " user_rejected",
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("throws when building rejected response with oversized rejectionReason", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: false,
        signerAddress: "hisham.spc",
        rejectionReason: "r".repeat(1024),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("binds approval response to origin/method/payload digest context", () => {
    const request = baseRequest();
    const response = buildApprovalResponse(request, {
      approved: true,
      signerAddress: "hisham.spc",
      signature: "a".repeat(64),
      decidedAtMs: now + 2_000,
    });

    expect(response.origin).toBe(request.origin);
    expect(response.method).toBe(request.method);
    expect(response.payloadHash.length).toBe(64);
  });

  it("rejects non-canonical signerAddress instead of trimming in approval response", () => {
    const request = baseRequest();
    expect(() =>
      buildApprovalResponse(request, {
        approved: true,
        signerAddress: "  hisham.spc  ",
        signature: "a".repeat(64),
        decidedAtMs: now + 2_000,
      }),
    ).toThrow();
  });

  it("computes expiration correctly", () => {
    expect(isWalletRequestExpired(baseRequest(), now + 61_000)).toBe(true);
    expect(isWalletRequestExpired(baseRequest(), now + 59_000)).toBe(false);
  });
});
