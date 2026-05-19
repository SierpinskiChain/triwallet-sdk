import { describe, expect, it } from "bun:test";
import {
  approveRequest,
  createApprovalQueue,
  dequeueNext,
  enqueueRequest,
  rejectRequest,
  runBackgroundSigner,
  verifyBackgroundSignature,
  type QueueRequest,
} from "./approval-queue";

const secret = "unit_test_secret";

const requestA: QueueRequest = {
  requestId: "req_1",
  chainId: "sierpinski-testnet-1",
  nonce: "100",
  origin: "https://market.sierpinskichain.com",
  method: "sendTransaction",
  payload: { amount: "1000" },
};

const requestB: QueueRequest = {
  requestId: "req_2",
  chainId: "sierpinski-testnet-1",
  nonce: "101",
  origin: "https://dex.sierpinskichain.com",
  method: "sendTransaction",
  payload: { amount: "250" },
};

describe("approval queue", () => {
  it("enqueues and dequeues in FIFO order", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, requestA);
    state = enqueueRequest(state, requestB);

    const first = dequeueNext(state);
    expect(first.next?.requestId).toBe("req_1");
    const second = dequeueNext(first.state);
    expect(second.next?.requestId).toBe("req_2");
  });

  it("blocks replay by requestId", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, requestA);
    state = enqueueRequest(state, requestA);
    expect(state.pending.length).toBe(1);
  });

  it("rejects malformed queue request domains before enqueue", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, {
      ...requestA,
      requestId: "   ",
    });
    expect(state.pending.length).toBe(0);

    state = enqueueRequest(state, {
      ...requestA,
      requestId: "req_bad_origin",
      origin: "http://localhost:3000",
    });
    expect(state.pending.length).toBe(0);

    state = enqueueRequest(state, {
      ...requestA,
      requestId: "r".repeat(300),
    });
    expect(state.pending.length).toBe(0);

    state = enqueueRequest(state, {
      ...requestA,
      requestId: "req_bad_payload_array",
      payload: [1, 2, 3] as unknown as Record<string, unknown>,
    });
    expect(state.pending.length).toBe(0);

    state = enqueueRequest(state, {
      ...requestA,
      requestId: 42 as unknown as string,
    });
    expect(state.pending.length).toBe(0);
  });

  it("blocks replay by nonce tuple even with different requestId", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, requestA);
    state = enqueueRequest(state, { ...requestA, requestId: "req_1b" });
    expect(state.pending.length).toBe(1);
  });

  it("keeps replay keys collision-safe when tuple fields contain delimiters", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, {
      requestId: "req_col_1",
      chainId: "chain::A",
      nonce: "n1",
      origin: "https://market.sierpinskichain.com",
      method: "send",
      payload: { amount: "100" },
    });
    state = enqueueRequest(state, {
      requestId: "req_col_2",
      chainId: "chain",
      nonce: "n1",
      origin: "https://dex.sierpinskichain.com",
      method: "send::A",
      payload: { amount: "100" },
    });
    expect(state.pending.length).toBe(2);
  });

  it("allows same nonce on different chain ids", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, requestA);
    state = enqueueRequest(state, {
      ...requestA,
      requestId: "req_1_mainnet",
      chainId: "sierpinski-mainnet-1",
    });
    expect(state.pending.length).toBe(2);
  });

  it("records approve/reject decisions", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, requestA);
    state = approveRequest(state, "req_1", 1_700_000_001_000);
    expect(state.decisions[0]?.status).toBe("approved");

    state = enqueueRequest(state, requestB);
    state = rejectRequest(state, "req_2", "user_rejected", 1_700_000_002_000);
    expect(state.decisions[1]?.status).toBe("rejected");
  });

  it("rejects non-finite decision timestamps", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, requestA);
    state = approveRequest(state, "req_1", Number.NaN);
    expect(state.decisions.length).toBe(0);

    state = enqueueRequest(state, requestB);
    state = rejectRequest(state, "req_2", "user_rejected", Number.POSITIVE_INFINITY);
    expect(state.decisions.length).toBe(0);
  });

  it("rejects malformed rejection reason domains", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, requestA);

    state = rejectRequest(state, "req_1", "   ", 1_700_000_003_000);
    expect(state.decisions.length).toBe(0);
    expect(state.pending.length).toBe(1);

    const oversizedReason = "x".repeat(300);
    state = rejectRequest(state, "req_1", oversizedReason, 1_700_000_003_001);
    expect(state.decisions.length).toBe(0);
    expect(state.pending.length).toBe(1);
  });

  it("rejectRequest fails closed on non-string reason domain without throwing", () => {
    let state = createApprovalQueue();
    state = enqueueRequest(state, requestA);
    const next = rejectRequest(
      state,
      requestA.requestId,
      123 as unknown as string,
      1_700_000_003_010,
    );
    expect(next.decisions.length).toBe(0);
    expect(next.pending.length).toBe(1);
  });

  it("background signer emits signatures only for approved decisions", () => {
    const signed = runBackgroundSigner(
      {
        requestId: "req_1",
        chainId: "sierpinski-testnet-1",
        origin: "https://market.sierpinskichain.com",
        method: "sendTransaction",
        payloadHash: "deadbeef",
        nonce: "100",
        status: "approved",
        decidedAtMs: 1_700_000_001_000,
      },
      "hisham.spc",
      secret,
    );
    expect(signed.signature).toBeDefined();
    expect(verifyBackgroundSignature(signed, secret)).toBe(true);

    const rejected = runBackgroundSigner(
      {
        requestId: "req_2",
        chainId: "sierpinski-testnet-1",
        origin: "https://dex.sierpinskichain.com",
        method: "sendTransaction",
        payloadHash: "beadfeed",
        nonce: "101",
        status: "rejected",
        decidedAtMs: 1_700_000_002_000,
      },
      "hisham.spc",
      secret,
    );
    expect(rejected.signature).toBeUndefined();
  });

  it("fails closed when signer secret is missing", () => {
    expect(() =>
      runBackgroundSigner(
        {
          requestId: "req_9",
          chainId: "sierpinski-testnet-1",
          origin: "https://market.sierpinskichain.com",
          method: "sendTransaction",
          payloadHash: "aa",
          nonce: "109",
          status: "approved",
          decidedAtMs: 1,
        },
        "hisham.spc",
        "",
      ),
    ).toThrow();
  });

  it("fails closed when signer address is missing", () => {
    expect(() =>
      runBackgroundSigner(
        {
          requestId: "req_9",
          chainId: "sierpinski-testnet-1",
          origin: "https://market.sierpinskichain.com",
          method: "sendTransaction",
          payloadHash: "aa",
          nonce: "109",
          status: "approved",
          decidedAtMs: 1,
        },
        "   ",
        secret,
      ),
    ).toThrow();
  });

  it("fails closed when signer address is non-canonical whitespace variant", () => {
    expect(() =>
      runBackgroundSigner(
        {
          requestId: "req_9",
          chainId: "sierpinski-testnet-1",
          origin: "https://market.sierpinskichain.com",
          method: "sendTransaction",
          payloadHash: "aa",
          nonce: "109",
          status: "approved",
          decidedAtMs: 1,
        },
        " hisham.spc",
        secret,
      ),
    ).toThrow();
  });

  it("fails closed when signer address exceeds max length", () => {
    expect(() =>
      runBackgroundSigner(
        {
          requestId: "req_9",
          chainId: "sierpinski-testnet-1",
          origin: "https://market.sierpinskichain.com",
          method: "sendTransaction",
          payloadHash: "aa",
          nonce: "109",
          status: "approved",
          decidedAtMs: 1,
        },
        "s".repeat(1024),
        secret,
      ),
    ).toThrow();
  });

  it("fails closed when signer address is non-string", () => {
    expect(() =>
      runBackgroundSigner(
        {
          requestId: "req_9",
          chainId: "sierpinski-testnet-1",
          origin: "https://market.sierpinskichain.com",
          method: "sendTransaction",
          payloadHash: "aa",
          nonce: "109",
          status: "approved",
          decidedAtMs: 1,
        },
        123 as unknown as string,
        secret,
      ),
    ).toThrow("signer address must be a string");
  });

  it("fails signature verification when secret is missing", () => {
    const signed = runBackgroundSigner(
      {
        requestId: "req_1",
        chainId: "sierpinski-testnet-1",
        origin: "https://market.sierpinskichain.com",
        method: "sendTransaction",
        payloadHash: "deadbeef",
        nonce: "100",
        status: "approved",
        decidedAtMs: 1_700_000_001_000,
      },
      "hisham.spc",
      secret,
    );
    expect(verifyBackgroundSignature(signed, "")).toBe(false);
  });

  it("fails signature verification when signer address is missing", () => {
    const signed = runBackgroundSigner(
      {
        requestId: "req_1",
        chainId: "sierpinski-testnet-1",
        origin: "https://market.sierpinskichain.com",
        method: "sendTransaction",
        payloadHash: "deadbeef",
        nonce: "100",
        status: "approved",
        decidedAtMs: 1_700_000_001_000,
      },
      "hisham.spc",
      secret,
    );
    expect(
      verifyBackgroundSignature(
        {
          ...signed,
          signerAddress: "   ",
        },
        secret,
      ),
    ).toBe(false);
  });

  it("fails signature verification when signer address is non-canonical whitespace variant", () => {
    const signed = runBackgroundSigner(
      {
        requestId: "req_1",
        chainId: "sierpinski-testnet-1",
        origin: "https://market.sierpinskichain.com",
        method: "sendTransaction",
        payloadHash: "deadbeef",
        nonce: "100",
        status: "approved",
        decidedAtMs: 1_700_000_001_000,
      },
      "hisham.spc",
      secret,
    );
    expect(
      verifyBackgroundSignature(
        {
          ...signed,
          signerAddress: " hisham.spc",
        },
        secret,
      ),
    ).toBe(false);
  });

  it("fails signature verification when signer address exceeds max length", () => {
    const signed = runBackgroundSigner(
      {
        requestId: "req_1",
        chainId: "sierpinski-testnet-1",
        origin: "https://market.sierpinskichain.com",
        method: "sendTransaction",
        payloadHash: "deadbeef",
        nonce: "100",
        status: "approved",
        decidedAtMs: 1_700_000_001_000,
      },
      "hisham.spc",
      secret,
    );
    expect(
      verifyBackgroundSignature(
        {
          ...signed,
          signerAddress: "s".repeat(1024),
        },
        secret,
      ),
    ).toBe(false);
  });

  it("fails signature verification when signer address is non-string", () => {
    const signed = runBackgroundSigner(
      {
        requestId: "req_1",
        chainId: "sierpinski-testnet-1",
        origin: "https://market.sierpinskichain.com",
        method: "sendTransaction",
        payloadHash: "deadbeef",
        nonce: "100",
        status: "approved",
        decidedAtMs: 1_700_000_001_000,
      },
      "hisham.spc",
      secret,
    );
    expect(
      verifyBackgroundSignature(
        {
          ...signed,
          signerAddress: 123 as unknown as string,
        },
        secret,
      ),
    ).toBe(false);
  });

  it("fails signature verification when signature is malformed non-hex", () => {
    const signed = runBackgroundSigner(
      {
        requestId: "req_1",
        chainId: "sierpinski-testnet-1",
        origin: "https://market.sierpinskichain.com",
        method: "sendTransaction",
        payloadHash: "deadbeef",
        nonce: "100",
        status: "approved",
        decidedAtMs: 1_700_000_001_000,
      },
      "hisham.spc",
      secret,
    );
    expect(
      verifyBackgroundSignature(
        {
          ...signed,
          signature: "not_hex_signature",
        },
        secret,
      ),
    ).toBe(false);
  });

  it("fails closed when signed decision envelope fields are oversized", () => {
    expect(() =>
      runBackgroundSigner(
        {
          requestId: "r".repeat(512),
          chainId: "sierpinski-testnet-1",
          origin: "https://market.sierpinskichain.com",
          method: "sendTransaction",
          payloadHash: "deadbeef",
          nonce: "100",
          status: "approved",
          decidedAtMs: 1_700_000_001_000,
        },
        "hisham.spc",
        secret,
      ),
    ).toThrow();
  });

  it("caps in-memory tracking structures to avoid unbounded growth", () => {
    let state = createApprovalQueue();
    for (let i = 0; i < 1200; i += 1) {
      state = enqueueRequest(state, {
        requestId: `req_${i}`,
        chainId: "sierpinski-testnet-1",
        nonce: `${10_000 + i}`,
        origin: "https://market.sierpinskichain.com",
        method: "sendTransaction",
        payload: { amount: `${i}` },
      });
      state = approveRequest(state, `req_${i}`, 1_700_000_000_000 + i);
    }
    expect(state.seenRequestIds.size).toBeLessThanOrEqual(1000);
    expect(state.seenReplayKeys.size).toBeLessThanOrEqual(1000);
    expect(state.decisions.length).toBeLessThanOrEqual(1000);
  });

  it("caps pending queue growth under request flood", () => {
    let state = createApprovalQueue();
    for (let i = 0; i < 1200; i += 1) {
      state = enqueueRequest(state, {
        requestId: `req_pending_${i}`,
        chainId: "sierpinski-testnet-1",
        nonce: `${20_000 + i}`,
        origin: "https://market.sierpinskichain.com",
        method: "sendTransaction",
        payload: { amount: `${i}` },
      });
    }
    expect(state.pending.length).toBeLessThanOrEqual(1000);
  });
});
