/**
 * TriWalletProvider — class-based API for dApp ↔ TriWallet communication.
 *
 * Usage:
 *   const tw = new TriWalletProvider({ walletUrl: "https://triwallet.sierpinskichain.com" });
 *   const accounts = await tw.requestAccounts();
 *   const sig = await tw.signMessage("hello");
 */

import type { ProviderConfig, TxParams } from "./types.js";
import {
  connectToTriWallet,
  listenForWalletResponses,
  TRIWALLET_URL,
} from "./bridge.js";

export class TriWalletProvider {
  private walletUrl: string;
  private connectedAccounts: string[] = [];
  private started = false;

  constructor(config: ProviderConfig = {}) {
    this.walletUrl = config.walletUrl ?? TRIWALLET_URL;
  }

  /** Start the postMessage listener. Call once on app init. Idempotent. */
  init(): void {
    if (this.started) return;
    listenForWalletResponses();
    this.started = true;
  }

  /** Request wallet connection. Opens TriWallet popup. */
  async requestAccounts(): Promise<string[]> {
    const accounts = (await connectToTriWallet(
      this.walletUrl,
      "spc_requestAccounts",
    )) as string[];
    this.connectedAccounts = accounts;
    return accounts;
  }

  /** Sign a message (for authentication). */
  async signMessage(message: string): Promise<string> {
    return connectToTriWallet(this.walletUrl, "spc_signMessage", [
      message,
    ]) as Promise<string>;
  }

  /** Sign and send a transaction. */
  async sendTransaction(params: TxParams): Promise<string> {
    return connectToTriWallet(this.walletUrl, "spc_sendTransaction", [
      params,
    ]) as Promise<string>;
  }

  /** Sign typed data (EIP-712 style). */
  async signTypedData(data: unknown): Promise<string> {
    return connectToTriWallet(this.walletUrl, "spc_signTypedData", [
      data,
    ]) as Promise<string>;
  }

  /** Check if an address holds a specific SBT (KYC credential). */
  async hasSbt(address: string, tokenType: string): Promise<boolean> {
    return connectToTriWallet(this.walletUrl, "spc_hasSbt", [
      address,
      tokenType,
    ]) as Promise<boolean>;
  }

  /** Resolve a .sp name to an address. */
  async resolveSpName(name: string): Promise<string> {
    return connectToTriWallet(this.walletUrl, "spc_resolveName", [
      name,
    ]) as Promise<string>;
  }

  /** Create a DID for an address. */
  async createDid(address: string): Promise<string> {
    return connectToTriWallet(this.walletUrl, "spc_createDid", [
      address,
    ]) as Promise<string>;
  }

  /** Get the accounts returned by the last successful requestAccounts call. */
  get accounts(): string[] {
    return this.connectedAccounts;
  }
}
