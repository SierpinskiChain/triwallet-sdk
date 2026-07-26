# @sierpinskichain/triwallet-sdk

TriWallet connector SDK for dApps on the [Sierpinski](https://sierpinskichain.com) blockchain.

Popup-based wallet connection using the postMessage protocol — open TriWallet, user approves, receive `.sp` address back.

## Install

```bash
npm install @sierpinskichain/triwallet-sdk
```

## Usage

### React

```tsx
import { TriWalletListener, useTriWallet } from "@sierpinskichain/triwallet-sdk/react";

// In your root layout (mounts the postMessage listener):
<TriWalletListener />

// In any component:
function ConnectButton() {
  const { connect, accounts, isConnecting, error } = useTriWallet();

  async function handleConnect() {
    try {
      const accounts = await connect();
      console.log("Connected:", accounts[0]); // .sp address
    } catch (err) {
      console.error("Connection failed:", err);
    }
  }

  return (
    <button onClick={handleConnect} disabled={isConnecting}>
      {isConnecting ? "Connecting…" : "Connect TriWallet"}
    </button>
  );
}
```

### Vanilla JS/TS

```ts
import { TriWalletProvider } from "@sierpinskichain/triwallet-sdk";

const tw = new TriWalletProvider();
tw.init(); // start postMessage listener

const accounts = await tw.requestAccounts();
const sig = await tw.signMessage("Login to MyDapp");
const txHash = await tw.sendTransaction({
  from: accounts[0],
  to: "recipient.sp",
  amount: "100",
});
```

### Low-level (no class)

```ts
import { connectTriWallet, listenForWalletResponses } from "@sierpinskichain/triwallet-sdk";

listenForWalletResponses();
const accounts = await connectTriWallet();
```

## API

### `@sierpinskichain/triwallet-sdk`

| Export | Description |
|---|---|
| `TriWalletProvider` | Class-based API: `init()`, `requestAccounts()`, `signMessage()`, `sendTransaction()`, `signTypedData()`, `hasSbt()`, `resolveSpName()`, `createDid()` |
| `connectTriWallet(url?)` | Open popup, request accounts → `Promise<string[]>` |
| `listenForWalletResponses()` | Start postMessage listener (call once on mount) |
| `signMessageWithTriWallet(msg, url?)` | Open popup, sign a message → `Promise<string>` |
| `sendTransactionViaTriWallet(params, url?)` | Open popup, send transaction → `Promise<string>` |
| `connectToTriWallet(url, method, params)` | Generic request to TriWallet popup |
| `TRIWALLET_URL` | Default TriWallet URL: `https://triwallet.sierpinskichain.com` |

### `@sierpinskichain/triwallet-sdk/react`

| Export | Description |
|---|---|
| `useTriWallet()` | React hook → `{ accounts, isConnecting, error, connect, disconnect }` |
| `TriWalletProvider` | Context provider for app-wide triwallet state |
| `useTriWalletContext()` | Access shared state from `<TriWalletProvider>` |
| `TriWalletListener` | Component that mounts the postMessage listener |

## Protocol

```
dApp ──popup──▶ TriWallet /dapp/connect?spc_request={id,method,params,origin}
                      │
                User approves/rejects
                      │
dApp ◀──postMessage── { type: "SPC_RESPONSE", id, result }
```

SessionStorage fallback when popup opener is blocked.

## License

MIT
