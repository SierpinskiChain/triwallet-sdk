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
