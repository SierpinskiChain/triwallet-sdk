import { describe, expect, it } from "bun:test";
import {
  createSierpinskiProvider,
  getSierpinskiWindowProvider,
  installSierpinskiWindowProvider,
  createWalletConnector,
  type SignedDecision,
  signWithConnector,
  submitDelegatedTransaction,
  verifyConnectorSignature,
} from "./wallet-connect";

const now = 1_700_000_000_000;

describe("wallet connect runtime", () => {
  it("connects and disconnects origin", () => {
    const connector = createWalletConnector({
      walletAccounts: ["hisham.spc", "ops.spc"],
      signerAddress: "hisham.spc",
      signerSecret: "secret",
    });

    expect(connector.isConnected("https://market.sierpinskichain.com")).toBe(false);

    connector.connect({
      origin: "https://market.sierpinskichain.com",
      exposeAccounts: ["hisham.spc"],
      permissions: ["request_signature", "send_transaction"],
      nowMs: now,
    });

    expect(connector.isConnected("https://market.sierpinskichain.com")).toBe(true);

    connector.disconnect("https://market.sierpinskichain.com", now + 1000);
    expect(connector.isConnected("https://market.sierpinskichain.com")).toBe(false);
  });

  it("signs and verifies payload for connected + authorized origin", () => {
    const connector = createWalletConnector({
      walletAccounts: ["hisham.spc"],
      signerAddress: "hisham.spc",
      signerSecret: "secret",
    });

    connector.connect({
      origin: "https://market.sierpinskichain.com",
      exposeAccounts: ["hisham.spc"],
      permissions: ["request_signature"],
      nowMs: now,
    });

    const signed = signWithConnector(connector, {
      origin: "https://market.sierpinskichain.com",
      chainId: "sierpinski-testnet-1",
      method: "personal_sign",
      nonce: "n-1",
      requestId: "req-sign-1",
      payload: { message: "hello" },
      decidedAtMs: now + 500,
    });

    expect(signed.status).toBe("approved");
    expect(signed.signature).toBeDefined();
    expect(verifyConnectorSignature(connector, signed)).toBe(true);
  });

  it("rejects delegated signing for unconnected origin", () => {
    const connector = createWalletConnector({
      walletAccounts: ["hisham.spc"],
      signerAddress: "hisham.spc",
      signerSecret: "secret",
    });

    expect(() =>
      signWithConnector(connector, {
        origin: "https://market.sierpinskichain.com",
        chainId: "sierpinski-testnet-1",
        method: "personal_sign",
        nonce: "n-1",
        requestId: "req-sign-1",
        payload: { message: "hello" },
        decidedAtMs: now + 500,
      }),
    ).toThrow();
  });

  it("submits delegated transaction signing for permitted origin", () => {
    const connector = createWalletConnector({
      walletAccounts: ["hisham.spc"],
      signerAddress: "hisham.spc",
      signerSecret: "secret",
    });

    connector.connect({
      origin: "https://market.sierpinskichain.com",
      exposeAccounts: ["hisham.spc"],
      permissions: ["send_transaction"],
      nowMs: now,
    });

    const signedTx = submitDelegatedTransaction(connector, {
      origin: "https://market.sierpinskichain.com",
      chainId: "sierpinski-testnet-1",
      nonce: "tx-1",
      requestId: "req-tx-1",
      method: "sendTransaction",
      payload: { from: "hisham.spc", to: "ops.spc", amount: "1" },
      decidedAtMs: now + 1_000,
    });

    expect(signedTx.status).toBe("approved");
    expect(signedTx.signature).toBeDefined();
    expect(verifyConnectorSignature(connector, signedTx)).toBe(true);
  });

  it("supports sierpinski_requestAccounts via provider runtime", async () => {
    const connector = createWalletConnector({
      walletAccounts: ["hisham.spc", "ops.spc"],
      signerAddress: "hisham.spc",
      signerSecret: "secret",
    });
    const provider = createSierpinskiProvider(connector, "https://market.sierpinskichain.com");

    const accounts = await provider.request({ method: "sierpinski_requestAccounts" });
    expect(accounts).toEqual(["hisham.spc"]);
    expect(connector.isConnected("https://market.sierpinskichain.com")).toBe(true);
  });

  it("supports sierpinski_signMessage via provider runtime", async () => {
    const connector = createWalletConnector({
      walletAccounts: ["hisham.spc"],
      signerAddress: "hisham.spc",
      signerSecret: "secret",
    });
    const provider = createSierpinskiProvider(connector, "https://market.sierpinskichain.com");

    const signed = await provider.request({
      method: "sierpinski_signMessage",
      params: { message: "hello", chainId: "sierpinski-testnet-1", nonce: "n-1", requestId: "req-sign-2" },
    });
    expect(typeof signed).toBe("object");
    const signedDecision = signed as SignedDecision;
    expect(signedDecision.status).toBe("approved");
    expect(verifyConnectorSignature(connector, signedDecision)).toBe(true);
  });

  it("supports sierpinski_sendTransaction and disconnect via provider runtime", async () => {
    const connector = createWalletConnector({
      walletAccounts: ["hisham.spc"],
      signerAddress: "hisham.spc",
      signerSecret: "secret",
    });
    const provider = createSierpinskiProvider(connector, "https://market.sierpinskichain.com");

    const signedTx = await provider.request({
      method: "sierpinski_sendTransaction",
      params: {
        chainId: "sierpinski-testnet-1",
        nonce: "tx-2",
        requestId: "req-tx-2",
        transaction: { to: "ops.spc", amount: "3", asset: "SPC" },
      },
    });
    expect(typeof signedTx).toBe("object");
    const signedTxDecision = signedTx as SignedDecision;
    expect(signedTxDecision.status).toBe("approved");
    expect(verifyConnectorSignature(connector, signedTxDecision)).toBe(true);

    const disconnected = await provider.request({ method: "sierpinski_disconnect" });
    expect(disconnected).toBe(true);
    expect(connector.isConnected("https://market.sierpinskichain.com")).toBe(false);
  });

  it("installs and resolves window.sierpinski provider", async () => {
    const connector = createWalletConnector({
      walletAccounts: ["hisham.spc"],
      signerAddress: "hisham.spc",
      signerSecret: "secret",
    });
    const globalLike = {} as { sierpinski?: ReturnType<typeof createSierpinskiProvider> };
    const installed = installSierpinskiWindowProvider(connector, "https://market.sierpinskichain.com", globalLike);
    expect(globalLike.sierpinski).toBe(installed);

    const resolved = getSierpinskiWindowProvider(globalLike);
    expect(resolved).not.toBeNull();
    const accounts = await resolved!.request({ method: "sierpinski_requestAccounts" });
    expect(accounts).toEqual(["hisham.spc"]);
  });
});
