import {
  approveRequest,
  createApprovalQueue,
  enqueueRequest,
  runBackgroundSigner,
  verifyBackgroundSignature,
  type QueueDecision,
  type QueueRequest,
  type QueueState,
  type SignedDecision,
} from "./approval-queue";
import {
  connectDapp,
  createPermissionsState,
  revokeOrigin,
  type PermissionsState,
} from "./dapp-permissions";

type ConnectorPermission = "request_signature" | "send_transaction";

export type ConnectorConnectRequest = {
  origin: string;
  exposeAccounts: string[];
  permissions: string[];
  nowMs: number;
};

export type ConnectorSignRequest = {
  origin: string;
  chainId: string;
  method: string;
  nonce: string;
  requestId: string;
  payload: Record<string, unknown>;
  decidedAtMs: number;
};

export type SierpinskiProviderRequest =
  | { method: "sierpinski_requestAccounts"; params?: undefined }
  | {
      method: "sierpinski_signMessage";
      params: {
        message: string;
        chainId: string;
        nonce: string;
        requestId: string;
        decidedAtMs?: number;
      };
    }
  | {
      method: "sierpinski_sendTransaction";
      params: {
        chainId: string;
        nonce: string;
        requestId: string;
        transaction: Record<string, unknown>;
        decidedAtMs?: number;
      };
    }
  | { method: "sierpinski_disconnect"; params?: undefined };

export type SierpinskiProvider = {
  request: (request: SierpinskiProviderRequest) => Promise<unknown>;
};

type SierpinskiGlobal = {
  sierpinski?: SierpinskiProvider;
};

export type WalletConnector = {
  connect: (request: ConnectorConnectRequest) => void;
  disconnect: (origin: string, nowMs: number) => void;
  isConnected: (origin: string) => boolean;
  permissionsState: () => PermissionsState;
  signerAddress: string;
  signerSecret: string;
  walletAccounts: string[];
};

export type WalletConnectorConfig = {
  walletAccounts: string[];
  signerAddress: string;
  signerSecret: string;
};

function canonicalOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function hasPermission(
  state: PermissionsState,
  origin: string,
  permission: ConnectorPermission,
): boolean {
  const canonical = canonicalOrigin(origin);
  if (!canonical) {
    return false;
  }
  const consent = state.byOrigin[canonical];
  return Boolean(consent && consent.permissions.includes(permission));
}

function hasSignerExposure(state: PermissionsState, origin: string, signerAddress: string): boolean {
  const canonical = canonicalOrigin(origin);
  if (!canonical) {
    return false;
  }
  const consent = state.byOrigin[canonical];
  return Boolean(consent && consent.exposedAccounts.includes(signerAddress));
}

function signApproved(
  queue: QueueState,
  signerAddress: string,
  signerSecret: string,
  requestId: string,
  decidedAtMs: number,
): { queue: QueueState; signed: SignedDecision } {
  const approvedQueue = approveRequest(queue, requestId, decidedAtMs);
  const decision = approvedQueue.decisions[approvedQueue.decisions.length - 1];
  if (!decision) {
    throw new Error("failed to approve wallet request");
  }
  const signed = runBackgroundSigner(decision, signerAddress, signerSecret);
  return { queue: approvedQueue, signed };
}

export function createWalletConnector(config: WalletConnectorConfig): WalletConnector {
  let permissions = createPermissionsState();
  let queue = createApprovalQueue();

  const connector: WalletConnector = {
    connect: (request: ConnectorConnectRequest) => {
      permissions = connectDapp(permissions, {
        origin: request.origin,
        walletAccounts: config.walletAccounts,
        exposeAccounts: request.exposeAccounts,
        permissions: request.permissions,
        nowMs: request.nowMs,
      });
    },
    disconnect: (origin: string, nowMs: number) => {
      permissions = revokeOrigin(permissions, origin, nowMs);
    },
    isConnected: (origin: string) => {
      const canonical = canonicalOrigin(origin);
      if (!canonical) {
        return false;
      }
      return Boolean(permissions.byOrigin[canonical]);
    },
    permissionsState: () => permissions,
    signerAddress: config.signerAddress,
    signerSecret: config.signerSecret,
    walletAccounts: config.walletAccounts,
  };

  Object.defineProperty(connector, "_queue", {
    enumerable: false,
    configurable: false,
    get: () => queue,
    set: (next: QueueState) => {
      queue = next;
    },
  });

  return connector;
}

function queueFor(connector: WalletConnector): QueueState {
  return (connector as WalletConnector & { _queue: QueueState })._queue;
}

function setQueue(connector: WalletConnector, next: QueueState): void {
  (connector as WalletConnector & { _queue: QueueState })._queue = next;
}

function toQueueRequest(input: ConnectorSignRequest): QueueRequest {
  return {
    requestId: input.requestId,
    chainId: input.chainId,
    nonce: input.nonce,
    origin: input.origin,
    method: input.method,
    payload: input.payload,
  };
}

export function signWithConnector(
  connector: WalletConnector,
  request: ConnectorSignRequest,
): SignedDecision {
  if (!connector.isConnected(request.origin)) {
    throw new Error("origin is not connected");
  }
  if (!hasPermission(connector.permissionsState(), request.origin, "request_signature")) {
    throw new Error("origin is not permitted for request_signature");
  }
  if (!hasSignerExposure(connector.permissionsState(), request.origin, connector.signerAddress)) {
    throw new Error("signer account is not exposed to origin");
  }

  const queueRequest = toQueueRequest(request);
  const nextQueue = enqueueRequest(queueFor(connector), queueRequest);
  setQueue(connector, nextQueue);

  const { queue, signed } = signApproved(
    nextQueue,
    connector.signerAddress,
    connector.signerSecret,
    request.requestId,
    request.decidedAtMs,
  );
  setQueue(connector, queue);
  return signed;
}

export function submitDelegatedTransaction(
  connector: WalletConnector,
  request: ConnectorSignRequest,
): SignedDecision {
  if (!connector.isConnected(request.origin)) {
    throw new Error("origin is not connected");
  }
  if (!hasPermission(connector.permissionsState(), request.origin, "send_transaction")) {
    throw new Error("origin is not permitted for send_transaction");
  }
  if (!hasSignerExposure(connector.permissionsState(), request.origin, connector.signerAddress)) {
    throw new Error("signer account is not exposed to origin");
  }

  const payloadFrom = request.payload.from;
  if (payloadFrom !== connector.signerAddress) {
    throw new Error("delegated transaction signer mismatch");
  }

  const queueRequest = toQueueRequest(request);
  const nextQueue = enqueueRequest(queueFor(connector), queueRequest);
  setQueue(connector, nextQueue);

  const { queue, signed } = signApproved(
    nextQueue,
    connector.signerAddress,
    connector.signerSecret,
    request.requestId,
    request.decidedAtMs,
  );
  setQueue(connector, queue);
  return signed;
}

export function verifyConnectorSignature(connector: WalletConnector, signed: SignedDecision): boolean {
  return verifyBackgroundSignature(signed, connector.signerSecret);
}

export function createSierpinskiProvider(
  connector: WalletConnector,
  origin: string,
  now: () => number = () => Date.now(),
): SierpinskiProvider {
  const ensureConnected = (timestampMs: number): void => {
    if (!connector.isConnected(origin)) {
      connector.connect({
        origin,
        exposeAccounts: [connector.signerAddress],
        permissions: ["request_signature", "send_transaction"],
        nowMs: timestampMs,
      });
    }
  };

  return {
    request: async (request: SierpinskiProviderRequest): Promise<unknown> => {
      if (request.method === "sierpinski_requestAccounts") {
        const at = now();
        ensureConnected(at);
        return [connector.signerAddress];
      }
      if (request.method === "sierpinski_disconnect") {
        connector.disconnect(origin, now());
        return true;
      }
      if (request.method === "sierpinski_signMessage") {
        const at = request.params.decidedAtMs ?? now();
        ensureConnected(at);
        return signWithConnector(connector, {
          origin,
          chainId: request.params.chainId,
          method: "sierpinski_signMessage",
          nonce: request.params.nonce,
          requestId: request.params.requestId,
          payload: { message: request.params.message },
          decidedAtMs: at,
        });
      }
      if (request.method === "sierpinski_sendTransaction") {
        const at = request.params.decidedAtMs ?? now();
        ensureConnected(at);
        const tx = request.params.transaction;
        const from =
          typeof tx.from === "string" && tx.from.trim().length > 0 ? tx.from : connector.signerAddress;
        return submitDelegatedTransaction(connector, {
          origin,
          chainId: request.params.chainId,
          method: "sierpinski_sendTransaction",
          nonce: request.params.nonce,
          requestId: request.params.requestId,
          payload: {
            ...tx,
            from,
          },
          decidedAtMs: at,
        });
      }
      throw new Error("unsupported sierpinski provider method");
    },
  };
}

export function installSierpinskiWindowProvider(
  connector: WalletConnector,
  origin: string,
  target: SierpinskiGlobal = globalThis as SierpinskiGlobal,
): SierpinskiProvider {
  const provider = createSierpinskiProvider(connector, origin);
  target.sierpinski = provider;
  return provider;
}

export function getSierpinskiWindowProvider(
  source: SierpinskiGlobal = globalThis as SierpinskiGlobal,
): SierpinskiProvider | null {
  if (source && source.sierpinski && typeof source.sierpinski.request === "function") {
    return source.sierpinski;
  }
  return null;
}

export type { QueueDecision, SignedDecision };
