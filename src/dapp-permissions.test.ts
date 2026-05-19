import { describe, expect, it } from "bun:test";
import {
  connectDapp,
  createPermissionsState,
  listOriginConsents,
  revokeOrigin,
  type DappPermissionRequest,
} from "./dapp-permissions";

const request: DappPermissionRequest = {
  origin: "https://market.sierpinskichain.com",
  walletAccounts: ["hisham.spc", "ops.spc"],
  exposeAccounts: ["hisham.spc"],
  permissions: ["read_balance", "request_signature"],
  nowMs: 1_700_000_000_000,
};

describe("dapp permissions", () => {
  it("connects origin with scoped account exposure", () => {
    const state = connectDapp(createPermissionsState(), request);
    const consent = state.byOrigin[request.origin];
    expect(consent?.exposedAccounts).toEqual(["hisham.spc"]);
    expect(consent?.permissions).toContain("request_signature");
  });

  it("updates existing origin consent and appends audit history", () => {
    let state = connectDapp(createPermissionsState(), request);
    state = connectDapp(state, {
      ...request,
      exposeAccounts: ["ops.spc"],
      nowMs: request.nowMs + 1000,
    });
    const consent = state.byOrigin[request.origin];
    expect(consent?.exposedAccounts).toEqual(["ops.spc"]);
    expect(state.auditTrail.length).toBe(2);
  });

  it("ignores connect requests with invalid nowMs", () => {
    const state = connectDapp(createPermissionsState(), {
      ...request,
      nowMs: Number.NaN,
    });
    expect(state.byOrigin[request.origin]).toBeUndefined();
    expect(state.auditTrail.length).toBe(0);
  });

  it("revokes origin and records revocation event", () => {
    let state = connectDapp(createPermissionsState(), request);
    state = revokeOrigin(state, request.origin, request.nowMs + 2000);
    expect(state.byOrigin[request.origin]).toBeUndefined();
    expect(state.auditTrail[state.auditTrail.length - 1]?.action).toBe("revoke");
  });

  it("ignores revoke requests with invalid nowMs", () => {
    let state = connectDapp(createPermissionsState(), request);
    state = revokeOrigin(state, request.origin, Number.POSITIVE_INFINITY);
    expect(state.byOrigin[request.origin]).toBeDefined();
  });

  it("ignores revoke requests with untrusted or oversized origin", () => {
    let state = connectDapp(createPermissionsState(), request);
    const beforeAuditLen = state.auditTrail.length;
    state = revokeOrigin(state, "http://localhost:3000", request.nowMs + 1);
    expect(state.byOrigin[request.origin]).toBeDefined();
    expect(state.auditTrail.length).toBe(beforeAuditLen);

    const oversizedOrigin = `https://${"a".repeat(2100)}.sierpinskichain.com`;
    state = revokeOrigin(state, oversizedOrigin, request.nowMs + 2);
    expect(state.byOrigin[request.origin]).toBeDefined();
    expect(state.auditTrail.length).toBe(beforeAuditLen);
  });

  it("lists consents sorted by latest timestamp desc", () => {
    let state = connectDapp(createPermissionsState(), request);
    state = connectDapp(state, {
      origin: "https://dex.sierpinskichain.com",
      walletAccounts: ["hisham.spc"],
      exposeAccounts: ["hisham.spc"],
      permissions: ["read_balance"],
      nowMs: request.nowMs + 3000,
    });

    const list = listOriginConsents(state);
    expect(list[0]?.origin).toBe("https://dex.sierpinskichain.com");
    expect(list[1]?.origin).toBe("https://market.sierpinskichain.com");
  });

  it("rejects untrusted origins for consent creation", () => {
    const state = connectDapp(createPermissionsState(), {
      ...request,
      origin: "http://localhost:3000",
    });
    expect(state.byOrigin["http://localhost:3000"]).toBeUndefined();
    expect(state.auditTrail[state.auditTrail.length - 1]?.action).toBe("reject_untrusted_origin");
  });

  it("does not trust caller-supplied accounts outside wallet accounts", () => {
    const state = connectDapp(createPermissionsState(), {
      ...request,
      walletAccounts: ["hisham.spc"],
      exposeAccounts: ["ops.spc"],
    });
    expect(state.byOrigin[request.origin]?.exposedAccounts).toEqual([]);
  });

  it("filters unknown permissions from consent scope", () => {
    const state = connectDapp(createPermissionsState(), {
      ...request,
      permissions: ["read_balance", "admin_root", "request_signature"],
    });
    expect(state.byOrigin[request.origin]?.permissions).toEqual([
      "read_balance",
      "request_signature",
    ]);
  });

  it("caps audit trail to bounded history", () => {
    let state = createPermissionsState();
    for (let i = 0; i < 1200; i += 1) {
      state = connectDapp(state, {
        ...request,
        nowMs: request.nowMs + i,
      });
    }
    expect(state.auditTrail.length).toBe(1000);
  });

  it("caps consent origins to bounded history under multi-origin connect flood", () => {
    let state = createPermissionsState();
    for (let i = 0; i < 1200; i += 1) {
      state = connectDapp(state, {
        origin: `https://dapp-${i}.sierpinskichain.com`,
        walletAccounts: ["hisham.spc"],
        exposeAccounts: ["hisham.spc"],
        permissions: ["read_balance"],
        nowMs: request.nowMs + i,
      });
    }
    expect(Object.keys(state.byOrigin).length).toBeLessThanOrEqual(1000);
  });

  it("normalizes trusted origins to canonical URL origin for consent and revoke", () => {
    let state = connectDapp(createPermissionsState(), {
      ...request,
      origin: "https://market.sierpinskichain.com/checkout?step=1",
    });
    expect(
      state.byOrigin["https://market.sierpinskichain.com/checkout?step=1"],
    ).toBeUndefined();
    expect(state.byOrigin["https://market.sierpinskichain.com"]).toBeDefined();

    state = revokeOrigin(state, "https://market.sierpinskichain.com/path", request.nowMs + 1);
    expect(state.byOrigin["https://market.sierpinskichain.com"]).toBeUndefined();
  });

  it("fails closed on oversized connect request collection domains", () => {
    const oversized = connectDapp(createPermissionsState(), {
      ...request,
      walletAccounts: Array.from({ length: 5000 }, (_, i) => `acct-${i}.spc`),
      exposeAccounts: Array.from({ length: 5000 }, (_, i) => `acct-${i}.spc`),
      permissions: Array.from({ length: 5000 }, () => "read_balance"),
    });
    expect(oversized.byOrigin[request.origin]).toBeUndefined();
    expect(oversized.auditTrail[oversized.auditTrail.length - 1]?.action).toBe(
      "reject_untrusted_origin",
    );
  });

  it("fails closed on malformed account identifier domains in connect request", () => {
    const malformed = connectDapp(createPermissionsState(), {
      ...request,
      walletAccounts: ["hisham.spc", " ".repeat(8), "a".repeat(4096)],
      exposeAccounts: ["hisham.spc"],
    });
    expect(malformed.byOrigin[request.origin]).toBeUndefined();
    expect(malformed.auditTrail[malformed.auditTrail.length - 1]?.action).toBe(
      "reject_untrusted_origin",
    );
  });

  it("fails closed on malformed permission identifier domains in connect request", () => {
    const malformed = connectDapp(createPermissionsState(), {
      ...request,
      permissions: ["read_balance", " request_signature", "x".repeat(4096)],
    });
    expect(malformed.byOrigin[request.origin]).toBeUndefined();
    expect(malformed.auditTrail[malformed.auditTrail.length - 1]?.action).toBe(
      "reject_untrusted_origin",
    );
  });

  it("fails closed without throwing on non-string account/permission entries", () => {
    expect(() =>
      connectDapp(createPermissionsState(), {
        ...request,
        walletAccounts: ["hisham.spc", 42 as unknown as string],
        exposeAccounts: ["hisham.spc"],
        permissions: ["read_balance", { bad: true } as unknown as string],
      }),
    ).not.toThrow();

    const malformed = connectDapp(createPermissionsState(), {
      ...request,
      walletAccounts: ["hisham.spc", 42 as unknown as string],
      exposeAccounts: ["hisham.spc"],
      permissions: ["read_balance", { bad: true } as unknown as string],
    });
    expect(malformed.byOrigin[request.origin]).toBeUndefined();
    expect(malformed.auditTrail[malformed.auditTrail.length - 1]?.action).toBe(
      "reject_untrusted_origin",
    );
  });

  it("fails closed without throwing on non-string origin domain", () => {
    expect(() =>
      connectDapp(createPermissionsState(), {
        ...request,
        origin: null as unknown as string,
      }),
    ).not.toThrow();

    const malformed = connectDapp(createPermissionsState(), {
      ...request,
      origin: null as unknown as string,
    });
    expect(malformed.byOrigin[request.origin]).toBeUndefined();
    expect(malformed.auditTrail[malformed.auditTrail.length - 1]?.action).toBe(
      "reject_untrusted_origin",
    );
    expect(typeof malformed.auditTrail[malformed.auditTrail.length - 1]?.origin).toBe("string");
  });

  it("normalizes malformed reject-audit origin strings to canonical trim-stable form", () => {
    const malformed = connectDapp(createPermissionsState(), {
      ...request,
      origin: "  http://localhost:3000  ",
    });
    expect(malformed.byOrigin[request.origin]).toBeUndefined();
    expect(malformed.auditTrail[malformed.auditTrail.length - 1]?.action).toBe(
      "reject_untrusted_origin",
    );
    expect(malformed.auditTrail[malformed.auditTrail.length - 1]?.origin).toBe(
      "http://localhost:3000",
    );
  });

  it("bounds reject-audit canonicalized origin length for oversized parseable URLs", () => {
    const oversizedParseableOrigin = `https://${"a".repeat(600)}.example.com`;
    const malformed = connectDapp(createPermissionsState(), {
      ...request,
      origin: oversizedParseableOrigin,
      walletAccounts: ["hisham.spc", " ".repeat(8)],
    });
    const reject = malformed.auditTrail[malformed.auditTrail.length - 1];
    expect(reject?.action).toBe("reject_untrusted_origin");
    expect(typeof reject?.origin).toBe("string");
    expect((reject?.origin ?? "").length).toBeLessThanOrEqual(256);
  });

  it("fails closed without throwing on non-array connect collection domains", () => {
    expect(() =>
      connectDapp(createPermissionsState(), {
        ...request,
        walletAccounts: null as unknown as string[],
        exposeAccounts: "hisham.spc" as unknown as string[],
        permissions: { p: "read_balance" } as unknown as string[],
      }),
    ).not.toThrow();

    const malformed = connectDapp(createPermissionsState(), {
      ...request,
      walletAccounts: null as unknown as string[],
      exposeAccounts: "hisham.spc" as unknown as string[],
      permissions: { p: "read_balance" } as unknown as string[],
    });
    expect(malformed.byOrigin[request.origin]).toBeUndefined();
    expect(malformed.auditTrail[malformed.auditTrail.length - 1]?.action).toBe(
      "reject_untrusted_origin",
    );
  });
});
