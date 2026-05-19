import { describe, expect, it } from "bun:test";
import { createWalletVault, unlockWalletVault, validateMnemonic, validatePasscode } from "./wallet-vault";
import { HdWallet } from "@sierpinskichain/sdk/wallet";

describe("wallet vault", () => {
  it("encrypts and unlocks a valid mnemonic", async () => {
    const mnemonic = HdWallet.generate().mnemonic;
    const passcode = "Correct-horse-battery1!";
    const vault = await createWalletVault({ mnemonic, passcode });
    const wallet = await unlockWalletVault(vault, passcode);
    expect(wallet.mnemonic).toBe(mnemonic);
    expect(wallet.address(0)).toBe(vault.accountAddress);
  });

  it("rejects wrong passcode", async () => {
    const mnemonic = HdWallet.generate().mnemonic;
    const vault = await createWalletVault({ mnemonic, passcode: "Correct-horse-battery1!" });
    await expect(unlockWalletVault(vault, "Wrong-passcode1!")).rejects.toThrow("Failed to unlock vault");
  });

  it("validates mnemonic format", () => {
    expect(validateMnemonic("one two three")).toBeNull();
  });

  it("enforces passcode policy", () => {
    expect(validatePasscode("short")).toContain("at least");
    expect(validatePasscode("alllowercase123!")).toContain("uppercase");
    expect(validatePasscode("Valid-Policy1!")).toBeNull();
  });
});
