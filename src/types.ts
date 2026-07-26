/** TriWallet SDK — shared types for dApp ↔ TriWallet communication. */

export type DappMethod =
  | "spc_requestAccounts"
  | "spc_sendTransaction"
  | "spc_signMessage"
  | "spc_signTypedData"
  | "spc_hasSbt"
  | "spc_getBalance"
  | "spc_resolveName"
  | "spc_createDid";

export interface DappRequest {
  id: string;
  method: DappMethod;
  params: unknown[];
  origin: string;
}

export interface DappResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface TxParams {
  from: string;
  to: string;
  amount: string;
  token?: string;
  memo?: string;
  finalityLevel?: number;
}

export interface ProviderConfig {
  /** TriWallet URL. Defaults to https://triwallet.sierpinskichain.com */
  walletUrl?: string;
}
