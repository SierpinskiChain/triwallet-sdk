# triwallet-sdk

TriWallet runtime SDK for:

- wallet request validation and approval response envelopes
- approval queue and signed decision verification
- dApp permissions and consent audit trail
- session runtime and trusted-origin checks
- transaction decode/simulation
- network/account profile runtime helpers
- encrypted mnemonic vault helpers
- wallet-connect style connect/disconnect and delegated signing

## Install

```bash
npm install @sierpinskichain/triwallet-sdk
```

## Usage

```ts
import {
  createRemotePopupConnector,
  getSierpinskiWindowProvider,
  validateWalletRequest,
} from "@sierpinskichain/triwallet-sdk";

const provider = getSierpinskiWindowProvider();
const accounts = await provider?.request({ method: "sierpinski_requestAccounts" });

const popup = createRemotePopupConnector({
  walletUrl: "https://wallet.sierpinskichain.com/popup",
  appOrigin: window.location.origin,
  targetOrigin: "https://wallet.sierpinskichain.com",
});
await popup.connect();
const remoteAccounts = await popup.request({ method: "sierpinski_requestAccounts" });

// If walletUrl is omitted (or root origin), the connector defaults to `/popup`.
// Connect handshake retries until ready (or timeout) to avoid first-message race on slow popup loads.
```

## Client Example (dApp with Popup Connector)

```ts
import { createRemotePopupConnector } from "@sierpinskichain/triwallet-sdk";

const popup = createRemotePopupConnector({
  // Optional: if omitted or root origin, SDK defaults to /popup
  walletUrl: "https://triwallet.org/popup",
  appOrigin: window.location.origin,
  targetOrigin: "https://triwallet.org",
  timeoutMs: 45_000,
});

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(36).slice(2)}`);

const newNonce = () => `${Date.now()}`;

export async function connectWallet() {
  await popup.connect();
  const accounts = (await popup.request({
    method: "sierpinski_requestAccounts",
  })) as string[];
  return accounts[0] ?? null;
}

export async function signMessage(message: string) {
  return popup.request({
    method: "sierpinski_signMessage",
    params: {
      message,
      chainId: "sierpinski-testnet-1",
      nonce: newNonce(),
      requestId: newId(),
    },
  });
}

export async function sendTransaction(to: string, amountAtomic: string) {
  return popup.request({
    method: "sierpinski_sendTransaction",
    params: {
      chainId: "sierpinski-testnet-1",
      nonce: newNonce(),
      requestId: newId(),
      transaction: {
        to,
        amount: amountAtomic,
        asset: "SPC",
      },
    },
  });
}

export async function disconnectWallet() {
  await popup.request({ method: "sierpinski_disconnect" });
  popup.disconnect();
}
```
