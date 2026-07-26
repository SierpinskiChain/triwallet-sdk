/**
 * TriWallet React bindings — hooks and components for dApp integration.
 *
 * Usage:
 *   // In your root layout:
 *   import { TriWalletListener } from "@sierpinskichain/triwallet-sdk/react";
 *   <TriWalletListener />
 *
 *   // In any component:
 *   import { useTriWallet } from "@sierpinskichain/triwallet-sdk/react";
 *   const { connect, accounts, isConnecting, error } = useTriWallet();
 */

"use client";

import {
  useCallback,
  useEffect,
  useState,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import {
  listenForWalletResponses,
  connectTriWallet,
  TRIWALLET_URL,
} from "./bridge.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TriWalletState {
  accounts: string[];
  isConnecting: boolean;
  error: string | null;
  connect: (walletUrl?: string) => Promise<string[]>;
  disconnect: () => void;
}

// ── Context (optional, for app-wide state sharing) ──────────────────────────

interface TriWalletContextValue extends TriWalletState {
  ready: boolean;
}

const TriWalletContext = createContext<TriWalletContextValue | null>(null);

export interface TriWalletProviderProps {
  children: ReactNode;
}

/**
 * Optional context provider for app-wide triwallet state.
 * If you prefer a single shared state across components, wrap your app with this.
 * Otherwise, use useTriWallet() which manages its own state.
 */
export function TriWalletProvider({ children }: TriWalletProviderProps) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (walletUrl?: string) => {
    setIsConnecting(true);
    setError(null);
    try {
      const result = await connectTriWallet(walletUrl);
      setAccounts(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccounts([]);
    setError(null);
  }, []);

  return (
    <TriWalletContext.Provider
      value={{ accounts, isConnecting, error, connect, disconnect, ready: true }}
    >
      {children}
    </TriWalletContext.Provider>
  );
}

/** Access the shared triwallet state from <TriWalletProvider>. */
export function useTriWalletContext(): TriWalletContextValue {
  const ctx = useContext(TriWalletContext);
  if (!ctx) {
    throw new Error(
      "useTriWalletContext must be used within a <TriWalletProvider>",
    );
  }
  return ctx;
}

// ── Standalone hook (no provider needed) ─────────────────────────────────────

/**
 * Standalone hook for triwallet connection. Manages its own local state.
 * Use this when you don't need app-wide shared state.
 */
export function useTriWallet(): TriWalletState {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (walletUrl?: string) => {
    setIsConnecting(true);
    setError(null);
    try {
      const result = await connectTriWallet(walletUrl);
      setAccounts(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccounts([]);
    setError(null);
  }, []);

  return { accounts, isConnecting, error, connect, disconnect };
}

// ── Listener component ───────────────────────────────────────────────────────

/**
 * Mounts the postMessage listener for TriWallet popup responses.
 * Include this once in your root layout. Renders nothing.
 */
export function TriWalletListener(): null {
  useEffect(() => {
    listenForWalletResponses();
  }, []);
  return null;
}
