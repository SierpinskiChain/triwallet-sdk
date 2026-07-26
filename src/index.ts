/**
 * @sierpinskichain/triwallet-sdk
 *
 * TriWallet connector SDK for dApps on the Sierpinski chain.
 * Popup-based wallet connection using postMessage protocol.
 */

// ── Types ───────────────────────────────────────────────────────────────────
export type {
  DappMethod,
  DappRequest,
  DappResponse,
  TxParams,
  ProviderConfig,
} from "./types.js";

// ── Bridge (low-level) ─────────────────────────────────────────────────────
export {
  TRIWALLET_URL,
  listenForWalletResponses,
  connectToTriWallet,
  connectTriWallet,
  signMessageWithTriWallet,
  sendTransactionViaTriWallet,
} from "./bridge.js";

// ── Provider (class-based) ─────────────────────────────────────────────────
export { TriWalletProvider } from "./provider.js";
