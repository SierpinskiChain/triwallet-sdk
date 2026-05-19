import { HdWallet } from "@sierpinskichain/sdk/wallet";

const VAULT_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 600_000;
const MIN_PASSCODE_LEN = 12;

export type WalletVault = {
  version: number;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  saltHex: string;
  ivHex: string;
  ciphertextHex: string;
  accountAddress: string;
  createdAtMs: number;
};

export function validatePasscode(passcode: string): string | null {
  if (typeof passcode !== "string") return "Invalid passcode";
  if (passcode.length < MIN_PASSCODE_LEN) {
    return `Passcode must be at least ${MIN_PASSCODE_LEN} characters`;
  }
  const hasUpper = /[A-Z]/.test(passcode);
  const hasLower = /[a-z]/.test(passcode);
  const hasDigit = /[0-9]/.test(passcode);
  const hasSymbol = /[^A-Za-z0-9]/.test(passcode);
  if (!hasUpper || !hasLower || !hasDigit || !hasSymbol) {
    return "Passcode must include uppercase, lowercase, number, and symbol";
  }
  return null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array | null {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto not available");
  }
  return globalThis.crypto;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveAesKey(passcode: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const cryptoApi = getCrypto();
  const passBytes = new TextEncoder().encode(passcode);
  const keyMaterial = await cryptoApi.subtle.importKey("raw", passBytes, "PBKDF2", false, ["deriveKey"]);
  return cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function normalizeMnemonic(mnemonic: string): string[] {
  return mnemonic
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

export function validateMnemonic(mnemonic: string): HdWallet | null {
  const words = normalizeMnemonic(mnemonic);
  return HdWallet.fromMnemonic(words);
}

export async function createWalletVault(opts: { mnemonic: string; passcode: string; nowMs?: number }): Promise<WalletVault> {
  const wallet = validateMnemonic(opts.mnemonic);
  if (!wallet) {
    throw new Error("Invalid mnemonic");
  }
  const passcodeError = validatePasscode(opts.passcode);
  if (passcodeError) {
    throw new Error(passcodeError);
  }

  const cryptoApi = getCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(opts.passcode, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(wallet.mnemonic);
  const ciphertext = new Uint8Array(
    await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext)),
  );

  return {
    version: VAULT_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    saltHex: toHex(salt),
    ivHex: toHex(iv),
    ciphertextHex: toHex(ciphertext),
    accountAddress: wallet.address(0),
    createdAtMs: Number.isFinite(opts.nowMs ?? Date.now()) ? Math.floor(opts.nowMs ?? Date.now()) : Date.now(),
  };
}

export async function unlockWalletVault(vault: WalletVault, passcode: string): Promise<HdWallet> {
  if (vault.version !== VAULT_VERSION || vault.kdf !== "PBKDF2-SHA256") {
    throw new Error("Unsupported vault format");
  }
  const passcodeError = validatePasscode(passcode);
  if (passcodeError) {
    throw new Error(passcodeError);
  }

  const salt = fromHex(vault.saltHex);
  const iv = fromHex(vault.ivHex);
  const ciphertext = fromHex(vault.ciphertextHex);
  if (!salt || !iv || !ciphertext) {
    throw new Error("Corrupt vault");
  }

  try {
    const key = await deriveAesKey(passcode, salt, vault.iterations);
    const plaintext = new Uint8Array(
      await getCrypto().subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv) },
        key,
        toArrayBuffer(ciphertext),
      ),
    );
    const mnemonic = new TextDecoder().decode(plaintext);
    const wallet = validateMnemonic(mnemonic);
    if (!wallet) {
      throw new Error("Invalid mnemonic");
    }
    if (wallet.address(0) !== vault.accountAddress) {
      throw new Error("Vault integrity mismatch");
    }
    return wallet;
  } catch {
    throw new Error("Failed to unlock vault");
  }
}
