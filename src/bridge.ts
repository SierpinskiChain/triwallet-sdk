/**
 * TriWallet bridge — low-level popup+postMessage protocol.
 *
 * Opens TriWallet as a popup, sends a dApp connection request via URL query
 * param, and waits for a postMessage (or sessionStorage) response.
 *
 * Designed to be framework-agnostic. For React bindings, see ./react.ts.
 */

import type { DappMethod, DappRequest, DappResponse } from "./types.js";

// ── Default URL ──────────────────────────────────────────────────────────────

export const TRIWALLET_URL = "https://triwallet.sierpinskichain.com";

// ── Pending request registry (shared across all calls) ──────────────────────

let requestCounter = 0;
const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

// ── Constants ────────────────────────────────────────────────────────────────

const POPUP_WIDTH = 420;
const POPUP_HEIGHT = 680;
const REQUEST_TIMEOUT_MS = 300_000; // 5 minutes
const RESPONSE_TYPE = "SPC_RESPONSE";

// ── Message listener (call once per dApp) ───────────────────────────────────

/**
 * Start listening for postMessage responses from TriWallet popups.
 * Call once on app mount. Idempotent — multiple calls are safe.
 */
export function listenForWalletResponses(): void {
  if (typeof window === "undefined") return;

  const handler = (event: MessageEvent) => {
    if (event.data?.type === RESPONSE_TYPE) {
      const { id, result, error } = event.data as DappResponse & { type: string };
      const pending = pendingRequests.get(id);
      if (pending) {
        pendingRequests.delete(id);
        if (error) {
          pending.reject(new Error(error.message ?? "Request rejected"));
        } else {
          pending.resolve(result);
        }
      }
    }
  };

  window.addEventListener("message", handler);

  // Also drain any sessionStorage-based responses (popup fallback)
  drainSessionStorage();
}

function drainSessionStorage(): void {
  if (typeof window === "undefined") return;
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (!key?.startsWith("spc_response_")) continue;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const response: DappResponse = JSON.parse(raw);
      const pending = pendingRequests.get(response.id);
      if (pending) {
        pendingRequests.delete(response.id);
        sessionStorage.removeItem(key);
        if (response.error) {
          pending.reject(new Error(response.error.message ?? "Request rejected"));
        } else {
          pending.resolve(response.result);
        }
      }
    } catch {
      // corrupted entry — skip
    }
  }
}

// ── Core connection function ─────────────────────────────────────────────────

/**
 * Open TriWallet popup and send a dApp request. Returns a promise that resolves
 * when the user approves, or rejects on timeout / rejection.
 */
export function connectToTriWallet(
  triWalletUrl: string,
  method: DappMethod,
  params: unknown[] = [],
  origin?: string,
): Promise<unknown> {
  const dappOrigin =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");

  return new Promise((resolve, reject) => {
    const id = `spc_${++requestCounter}_${Date.now()}`;
    const request: DappRequest = { id, method, params, origin: dappOrigin };

    pendingRequests.set(id, { resolve, reject });

    // Timeout guard
    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("TriWallet request timed out"));
      }
    }, REQUEST_TIMEOUT_MS);

    // Wrap reject to also clear timer
    const guardedReject = (err: Error) => {
      clearTimeout(timer);
      reject(err);
    };

    // Override the stored reject to clear timer
    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: guardedReject,
    });

    // Open popup
    const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
    const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;

    const payload = encodeURIComponent(JSON.stringify(request));
    const url = `${triWalletUrl}/dapp/connect?spc_request=${payload}`;

    const popup = window.open(
      url,
      "TriWallet",
      `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},popup=1`,
    );

    if (!popup) {
      pendingRequests.delete(id);
      clearTimeout(timer);
      reject(
        new Error("Popup blocked. Please allow popups to connect your wallet."),
      );
    }
  });
}

// ── Convenience helpers ─────────────────────────────────────────────────────

export function connectTriWallet(
  walletUrl = TRIWALLET_URL,
): Promise<string[]> {
  return connectToTriWallet(walletUrl, "spc_requestAccounts") as Promise<string[]>;
}

export function signMessageWithTriWallet(
  message: string,
  walletUrl = TRIWALLET_URL,
): Promise<string> {
  return connectToTriWallet(walletUrl, "spc_signMessage", [message]) as Promise<string>;
}

export function sendTransactionViaTriWallet(
  params: import("./types.js").TxParams,
  walletUrl = TRIWALLET_URL,
): Promise<string> {
  return connectToTriWallet(walletUrl, "spc_sendTransaction", [params]) as Promise<string>;
}
