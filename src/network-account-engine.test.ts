import { describe, expect, it } from "bun:test";
import {
  addAddressBookEntry,
  addAccount,
  createNetworkAccountState,
  setActiveAccount,
  setActiveNetwork,
  upsertNetworkProfile,
  validateRpcEndpoint,
  validateWsEndpoint,
  type NetworkProfile,
} from "./network-account-engine";

describe("network + account engine", () => {
  it("creates default state with one account and testnet profile", () => {
    const state = createNetworkAccountState();
    expect(state.accounts.length).toBe(1);
    expect(state.networks.length).toBeGreaterThanOrEqual(2);
    expect(state.activeAccountId).toBe(state.accounts[0]?.id);
    expect(state.activeNetworkId).toBe("sierpinski-testnet-1");
  });

  it("adds an account and switches active account", () => {
    let state = createNetworkAccountState();
    state = addAccount(state, { id: "acc_2", name: "Ops", address: "ops.spc" });
    state = setActiveAccount(state, "acc_2");
    expect(state.activeAccountId).toBe("acc_2");
  });

  it("rejects account entries with malformed identifier domains", () => {
    let state = createNetworkAccountState();
    const before = state.accounts.length;

    state = addAccount(state, { id: "   ", name: "Ops", address: "ops.spc" });
    state = addAccount(state, { id: "acc_2", name: " ", address: "ops.spc" });
    state = addAccount(state, { id: "acc_3", name: "Ops", address: " " });
    state = addAccount(state, { id: " acc_4", name: "Ops", address: "ops.spc" });
    state = addAccount(state, { id: "acc_5", name: "Ops ", address: "ops.spc" });
    state = addAccount(state, { id: "acc_6", name: "Ops", address: " ops.spc" });
    state = addAccount(state, { id: 123 as unknown as string, name: "Ops", address: "ops.spc" });
    state = addAccount(state, { id: "acc_7", name: true as unknown as string, address: "ops.spc" });
    state = addAccount(state, { id: "acc_8", name: "Ops", address: {} as unknown as string });

    expect(state.accounts.length).toBe(before);
  });

  it("upserts custom network profile and switches network", () => {
    let state = createNetworkAccountState();
    const custom: NetworkProfile = {
      id: "custom-lab",
      label: "Lab",
      rpcUrl: "https://lab.sierpinski.example/rpc",
      wsUrl: "wss://lab.sierpinski.example/ws",
      isDefault: false,
    };
    state = upsertNetworkProfile(state, custom);
    state = setActiveNetwork(state, "custom-lab");

    expect(state.activeNetworkId).toBe("custom-lab");
    expect(state.networks.find((n) => n.id === "custom-lab")?.rpcUrl).toBe(custom.rpcUrl);
  });

  it("stores address-book entries", () => {
    let state = createNetworkAccountState();
    state = addAddressBookEntry(state, {
      id: "entry_1",
      label: "Merchant",
      address: "merchant.spc",
    });
    expect(state.addressBook.length).toBe(1);
    expect(state.addressBook[0]?.label).toBe("Merchant");
  });

  it("rejects malformed address-book entry domains", () => {
    let state = createNetworkAccountState();
    state = addAddressBookEntry(state, {
      id: "   ",
      label: "Merchant",
      address: "merchant.spc",
    });
    expect(state.addressBook.length).toBe(0);

    state = addAddressBookEntry(state, {
      id: "entry_1",
      label: " ",
      address: "merchant.spc",
    });
    expect(state.addressBook.length).toBe(0);

    state = addAddressBookEntry(state, {
      id: "entry_2",
      label: "Merchant",
      address: " ",
    });
    expect(state.addressBook.length).toBe(0);

    state = addAddressBookEntry(state, {
      id: 1 as unknown as string,
      label: "Merchant",
      address: "merchant.spc",
    });
    expect(state.addressBook.length).toBe(0);
  });

  it("rejects non-canonical address-book entry whitespace variants", () => {
    let state = createNetworkAccountState();
    const before = state.addressBook.length;

    state = addAddressBookEntry(state, {
      id: " entry_1",
      label: "Merchant",
      address: "merchant.spc",
    });
    state = addAddressBookEntry(state, {
      id: "entry_2",
      label: "Merchant ",
      address: "merchant.spc",
    });
    state = addAddressBookEntry(state, {
      id: "entry_3",
      label: "Merchant",
      address: " merchant.spc",
    });

    expect(state.addressBook.length).toBe(before);
  });

  it("rejects oversized address-book entry fields", () => {
    let state = createNetworkAccountState();
    state = addAddressBookEntry(state, {
      id: "i".repeat(300),
      label: "Merchant",
      address: "merchant.spc",
    });
    expect(state.addressBook.length).toBe(0);

    state = addAddressBookEntry(state, {
      id: "entry_1",
      label: "L".repeat(300),
      address: "merchant.spc",
    });
    expect(state.addressBook.length).toBe(0);

    state = addAddressBookEntry(state, {
      id: "entry_2",
      label: "Merchant",
      address: "a".repeat(300),
    });
    expect(state.addressBook.length).toBe(0);
  });

  it("caps runtime account/network/address-book collections", () => {
    let state = createNetworkAccountState();
    for (let i = 0; i < 1100; i += 1) {
      state = addAccount(state, {
        id: `acc_${i + 2}`,
        name: `Account ${i + 2}`,
        address: `account_${i + 2}.spc`,
      });
      state = addAddressBookEntry(state, {
        id: `entry_${i + 1}`,
        label: `Entry ${i + 1}`,
        address: `entry_${i + 1}.spc`,
      });
      state = upsertNetworkProfile(state, {
        id: `custom_${i + 1}`,
        label: `Custom ${i + 1}`,
        rpcUrl: `https://rpc-${i + 1}.sierpinski.example/rpc`,
        wsUrl: `wss://rpc-${i + 1}.sierpinski.example/ws`,
        isDefault: false,
      });
    }

    expect(state.accounts.length).toBeLessThanOrEqual(1000);
    expect(state.addressBook.length).toBeLessThanOrEqual(1000);
    expect(state.networks.length).toBeLessThanOrEqual(1000);
  });

  it("accepts secure rpc endpoints and rejects unsafe ones", () => {
    expect(validateRpcEndpoint("https://wallet.testnet.sierpinskichain.com/rpc").ok).toBe(true);
    expect(validateRpcEndpoint("http://wallet.testnet.sierpinskichain.com/rpc").ok).toBe(false);
    expect(validateRpcEndpoint("https://localhost:40404/rpc").ok).toBe(false);
    expect(validateRpcEndpoint("https://10.0.0.10/rpc").ok).toBe(false);
    expect(validateRpcEndpoint("https://[::1]/rpc").ok).toBe(false);
    const oversizedRpc = `https://${"a".repeat(3000)}.sierpinski.example/rpc`;
    expect(validateRpcEndpoint(oversizedRpc).ok).toBe(false);
  });

  it("fails closed on non-string rpc endpoint domains without throwing", () => {
    expect(
      validateRpcEndpoint({ href: "https://wallet.testnet.sierpinskichain.com/rpc" } as unknown as string).ok,
    ).toBe(false);
    expect(validateRpcEndpoint(123 as unknown as string).ok).toBe(false);
  });

  it("accepts secure ws endpoints and rejects unsafe ones", () => {
    expect(validateWsEndpoint("wss://wallet.testnet.sierpinskichain.com/ws").ok).toBe(true);
    expect(validateWsEndpoint("ws://wallet.testnet.sierpinskichain.com/ws").ok).toBe(false);
    expect(validateWsEndpoint("wss://localhost:40404/ws").ok).toBe(false);
    expect(validateWsEndpoint("wss://172.16.5.4/ws").ok).toBe(false);
    expect(validateWsEndpoint("wss://api.localhost/ws").ok).toBe(false);
    const oversizedWs = `wss://${"a".repeat(3000)}.sierpinski.example/ws`;
    expect(validateWsEndpoint(oversizedWs).ok).toBe(false);
  });

  it("fails closed on non-string ws endpoint domains without throwing", () => {
    expect(
      validateWsEndpoint({ href: "wss://wallet.testnet.sierpinskichain.com/ws" } as unknown as string).ok,
    ).toBe(false);
    expect(validateWsEndpoint(123 as unknown as string).ok).toBe(false);
  });

  it("rejects network profile when ws endpoint is unsafe", () => {
    let state = createNetworkAccountState();
    const invalid: NetworkProfile = {
      id: "unsafe-lab",
      label: "Unsafe",
      rpcUrl: "https://lab.sierpinski.example/rpc",
      wsUrl: "ws://lab.sierpinski.example/ws",
      isDefault: false,
    };
    state = upsertNetworkProfile(state, invalid);
    expect(state.networks.find((n) => n.id === "unsafe-lab")).toBeUndefined();
  });

  it("rejects network profile with invalid id/label domains", () => {
    let state = createNetworkAccountState();
    const invalidId: NetworkProfile = {
      id: "   ",
      label: "Lab",
      rpcUrl: "https://lab.sierpinski.example/rpc",
      wsUrl: "wss://lab.sierpinski.example/ws",
      isDefault: false,
    };
    state = upsertNetworkProfile(state, invalidId);
    expect(state.networks.find((n) => n.label === "Lab")).toBeUndefined();

    const invalidLabel: NetworkProfile = {
      id: "lab-2",
      label: " ",
      rpcUrl: "https://lab2.sierpinski.example/rpc",
      wsUrl: "wss://lab2.sierpinski.example/ws",
      isDefault: false,
    };
    state = upsertNetworkProfile(state, invalidLabel);
    expect(state.networks.find((n) => n.id === "lab-2")).toBeUndefined();

    const nonStringId: NetworkProfile = {
      id: 1 as unknown as string,
      label: "Lab",
      rpcUrl: "https://lab5.sierpinski.example/rpc",
      wsUrl: "wss://lab5.sierpinski.example/ws",
      isDefault: false,
    };
    state = upsertNetworkProfile(state, nonStringId);
    expect(state.networks.find((n) => n.label === "Lab" && n.rpcUrl.includes("lab5"))).toBeUndefined();
  });

  it("rejects network profile with non-canonical id/label whitespace variants", () => {
    let state = createNetworkAccountState();
    const nonCanonicalId: NetworkProfile = {
      id: " lab-3",
      label: "Lab",
      rpcUrl: "https://lab3.sierpinski.example/rpc",
      wsUrl: "wss://lab3.sierpinski.example/ws",
      isDefault: false,
    };
    state = upsertNetworkProfile(state, nonCanonicalId);
    expect(state.networks.find((n) => n.id === " lab-3")).toBeUndefined();

    const nonCanonicalLabel: NetworkProfile = {
      id: "lab-4",
      label: "Lab ",
      rpcUrl: "https://lab4.sierpinski.example/rpc",
      wsUrl: "wss://lab4.sierpinski.example/ws",
      isDefault: false,
    };
    state = upsertNetworkProfile(state, nonCanonicalLabel);
    expect(state.networks.find((n) => n.id === "lab-4")).toBeUndefined();
  });
});
