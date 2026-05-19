# triwallet-sdk

TriWallet runtime SDK for:

- wallet request validation and approval response envelopes
- approval queue and signed decision verification
- dApp permissions and consent audit trail
- session runtime and trusted-origin checks
- transaction decode/simulation
- network/account profile runtime helpers
- encrypted mnemonic vault helpers

## Install

```bash
npm install @sierpinskichain/triwallet-sdk
```

## Usage

```ts
import { validateWalletRequest, createApprovalQueue, runSecurityPack } from "@sierpinskichain/triwallet-sdk";
```
