import { isDisallowedHost } from "./session-runtime";

const MAX_RUNTIME_COLLECTION_ENTRIES = 1000;
const MAX_ENDPOINT_URL_LENGTH = 2048;
const MAX_NETWORK_ID_LENGTH = 128;
const MAX_NETWORK_LABEL_LENGTH = 128;
const MAX_ADDRESS_BOOK_ENTRY_ID_LENGTH = 128;
const MAX_ADDRESS_BOOK_ENTRY_LABEL_LENGTH = 128;
const MAX_ADDRESS_BOOK_ENTRY_ADDRESS_LENGTH = 128;
const MAX_ACCOUNT_ID_LENGTH = 128;
const MAX_ACCOUNT_NAME_LENGTH = 128;
const MAX_ACCOUNT_ADDRESS_LENGTH = 128;

export type AccountProfile = {
  id: string;
  name: string;
  address: string;
};

export type NetworkProfile = {
  id: string;
  label: string;
  rpcUrl: string;
  wsUrl: string;
  isDefault: boolean;
};

export type AddressBookEntry = {
  id: string;
  label: string;
  address: string;
};

export type NetworkAccountState = {
  accounts: AccountProfile[];
  activeAccountId: string;
  networks: NetworkProfile[];
  activeNetworkId: string;
  addressBook: AddressBookEntry[];
};

export function createNetworkAccountState(): NetworkAccountState {
  const accounts: AccountProfile[] = [
    { id: "acc_1", name: "Primary", address: "hisham.spc" },
  ];
  const networks: NetworkProfile[] = [
    {
      id: "sierpinski-testnet-1",
      label: "Sierpinski Testnet",
      rpcUrl: "https://rpc1.testnet.sierpinskichain.com",
      wsUrl: "wss://rpc1.testnet.sierpinskichain.com/ws",
      isDefault: true,
    },
    {
      id: "sierpinski-mainnet-1",
      label: "Sierpinski Mainnet",
      rpcUrl: "https://wallet.sierpinskichain.com/rpc",
      wsUrl: "wss://wallet.sierpinskichain.com/ws",
      isDefault: true,
    },
  ];

  return {
    accounts,
    activeAccountId: accounts[0].id,
    networks,
    activeNetworkId: "sierpinski-testnet-1",
    addressBook: [],
  };
}

export function addAccount(
  state: NetworkAccountState,
  account: AccountProfile,
): NetworkAccountState {
  if (typeof account.id !== "string" || typeof account.name !== "string" || typeof account.address !== "string") {
    return state;
  }
  if (!account.id.trim() || account.id.trim() !== account.id || account.id.length > MAX_ACCOUNT_ID_LENGTH) {
    return state;
  }
  if (
    !account.name.trim() ||
    account.name.trim() !== account.name ||
    account.name.length > MAX_ACCOUNT_NAME_LENGTH
  ) {
    return state;
  }
  if (
    !account.address.trim() ||
    account.address.trim() !== account.address ||
    account.address.length > MAX_ACCOUNT_ADDRESS_LENGTH
  ) {
    return state;
  }
  const nextAccounts = [...state.accounts, account].slice(-MAX_RUNTIME_COLLECTION_ENTRIES);
  const activeStillExists = nextAccounts.some((a) => a.id === state.activeAccountId);
  return {
    ...state,
    accounts: nextAccounts,
    activeAccountId: activeStillExists ? state.activeAccountId : nextAccounts[0]?.id ?? "",
  };
}

export function setActiveAccount(
  state: NetworkAccountState,
  accountId: string,
): NetworkAccountState {
  const exists = state.accounts.some((a) => a.id === accountId);
  if (!exists) {
    return state;
  }
  return {
    ...state,
    activeAccountId: accountId,
  };
}

export function upsertNetworkProfile(
  state: NetworkAccountState,
  network: NetworkProfile,
): NetworkAccountState {
  if (
    typeof network.id !== "string" ||
    typeof network.label !== "string" ||
    typeof network.rpcUrl !== "string" ||
    typeof network.wsUrl !== "string"
  ) {
    return state;
  }
  if (
    !network.id.trim() ||
    network.id.trim() !== network.id ||
    network.id.length > MAX_NETWORK_ID_LENGTH
  ) {
    return state;
  }
  if (
    !network.label.trim() ||
    network.label.trim() !== network.label ||
    network.label.length > MAX_NETWORK_LABEL_LENGTH
  ) {
    return state;
  }
  const rpcValidation = validateRpcEndpoint(network.rpcUrl);
  if (!rpcValidation.ok) {
    return state;
  }
  const wsValidation = validateWsEndpoint(network.wsUrl);
  if (!wsValidation.ok) {
    return state;
  }

  const index = state.networks.findIndex((n) => n.id === network.id);
  if (index === -1) {
    const nextNetworks = [...state.networks, network].slice(-MAX_RUNTIME_COLLECTION_ENTRIES);
    const activeStillExists = nextNetworks.some((n) => n.id === state.activeNetworkId);
    return {
      ...state,
      networks: nextNetworks,
      activeNetworkId: activeStillExists ? state.activeNetworkId : nextNetworks[0]?.id ?? "",
    };
  }

  const next = [...state.networks];
  next[index] = network;
  return {
    ...state,
    networks: next,
  };
}

export function setActiveNetwork(
  state: NetworkAccountState,
  networkId: string,
): NetworkAccountState {
  const exists = state.networks.some((n) => n.id === networkId);
  if (!exists) {
    return state;
  }
  return {
    ...state,
    activeNetworkId: networkId,
  };
}

export function addAddressBookEntry(
  state: NetworkAccountState,
  entry: AddressBookEntry,
): NetworkAccountState {
  if (
    typeof entry.id !== "string" ||
    typeof entry.label !== "string" ||
    typeof entry.address !== "string"
  ) {
    return state;
  }
  if (
    !entry.id.trim() ||
    entry.id.trim() !== entry.id ||
    entry.id.length > MAX_ADDRESS_BOOK_ENTRY_ID_LENGTH
  ) {
    return state;
  }
  if (
    !entry.label.trim() ||
    entry.label.trim() !== entry.label ||
    entry.label.length > MAX_ADDRESS_BOOK_ENTRY_LABEL_LENGTH
  ) {
    return state;
  }
  if (
    !entry.address.trim() ||
    entry.address.trim() !== entry.address ||
    entry.address.length > MAX_ADDRESS_BOOK_ENTRY_ADDRESS_LENGTH
  ) {
    return state;
  }
  return {
    ...state,
    addressBook: [...state.addressBook, entry].slice(-MAX_RUNTIME_COLLECTION_ENTRIES),
  };
}

export function validateRpcEndpoint(url: string): { ok: boolean; reason?: string } {
  if (typeof url !== "string") {
    return { ok: false, reason: "invalid rpc endpoint domain" };
  }
  if (url.length > MAX_ENDPOINT_URL_LENGTH) {
    return { ok: false, reason: "rpc endpoint exceeds max length" };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "rpc endpoint must use https" };
    }
    if (isDisallowedHost(parsed.hostname)) {
      return { ok: false, reason: "private/loopback rpc endpoint is not allowed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid rpc endpoint url" };
  }
}

export function validateWsEndpoint(url: string): { ok: boolean; reason?: string } {
  if (typeof url !== "string") {
    return { ok: false, reason: "invalid ws endpoint domain" };
  }
  if (url.length > MAX_ENDPOINT_URL_LENGTH) {
    return { ok: false, reason: "ws endpoint exceeds max length" };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "wss:") {
      return { ok: false, reason: "ws endpoint must use wss" };
    }
    if (isDisallowedHost(parsed.hostname)) {
      return { ok: false, reason: "private/loopback ws endpoint is not allowed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid ws endpoint url" };
  }
}
