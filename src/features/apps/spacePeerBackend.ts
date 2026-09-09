import { devicesApi, type SignedDeviceRequest } from "@/api/devices/api";
import { readDeploymentScope } from "@/api/deployment/api";
import {
  agentsDeviceSnapshot,
  ensureServerAgentDevice,
  signedAgentDeviceRequest,
} from "@/features/agents";
import type { AppRpcScope } from "./rpc/session";
import type { SpacePeerBackend, SpacePeerRow } from "./spacePeerBridge";

/** Mac Files worker backend. This adapter stays in the compiled Host; package
 * code receives neither device signing credentials nor server session tokens. */
export function createSpacePeerBackend(
  scope: AppRpcScope,
  options: {
    invoke: SpacePeerBackend["invoke"];
    native(method: string, params?: unknown): Promise<unknown>;
  },
): SpacePeerBackend {
  const deployment = readDeploymentScope();
  const assertCurrent = () => {
    scope.assert("files.read");
    scope.assert("connections.read");
    if (readDeploymentScope() !== deployment) throw new Error("The peer deployment changed.");
  };
  const signed: SignedDeviceRequest = (local, path, init) => {
    assertCurrent();
    return signedAgentDeviceRequest(local, path, { ...init, signal: scope.signal }, assertCurrent);
  };
  return {
    invoke: options.invoke,
    async authorize() {
      assertCurrent();
      await options.native("files.sources.list", {});
      assertCurrent();
      await options.native("connections.authorize", {});
      assertCurrent();
    },
    async device(instance) {
      assertCurrent();
      const { device } = await agentsDeviceSnapshot();
      assertCurrent();
      if (!device) throw new Error("This device is not available for peer access.");
      const endpointId = await options.invoke<string>("space_peer_local_identity", {
        instance,
        deviceId: device.id,
      });
      assertCurrent();
      const server = await ensureServerAgentDevice(device, {
        endpointId,
        platform: "macos",
        scope: { assertCurrent, signal: scope.signal },
      });
      assertCurrent();
      return { localId: device.id, serverId: server.id };
    },
    async keys() {
      assertCurrent();
      const response = await devicesApi.peerTicketKeys<{
        algorithm: string;
        keys: Record<string, string>;
      }>();
      assertCurrent();
      if (response.algorithm !== "Ed25519")
        throw new Error("The peer ticket signing algorithm is unsupported.");
      return response.keys;
    },
    async presence(device, space, body) {
      assertCurrent();
      if (space !== scope.identity.spaceId)
        throw new Error("Peer presence belongs to another Space.");
      if (!body.addressing || typeof body.addressing !== "object" || Array.isArray(body.addressing))
        throw new Error("Invalid peer address.");
      return devicesApi.spacePresence(signed, device.localId, device.serverId, space, {
        ...body,
        addressing: body.addressing as Record<string, unknown>,
      });
    },
    async peers(device, space) {
      assertCurrent();
      if (space !== scope.identity.spaceId)
        throw new Error("Peer discovery belongs to another Space.");
      const response = await devicesApi.spacePeers<{ peers: SpacePeerRow[] }>(
        signed,
        device.localId,
        device.serverId,
        space,
      );
      assertCurrent();
      if (!Array.isArray(response.peers)) throw new Error("Invalid Space peer list.");
      return response.peers;
    },
    async ticket(device, space, target) {
      assertCurrent();
      if (space !== scope.identity.spaceId)
        throw new Error("Peer ticket belongs to another Space.");
      const response = await devicesApi.issueSpacePeerTicket<{ ticket: string }>(
        signed,
        device.localId,
        device.serverId,
        space,
        target,
      );
      assertCurrent();
      return response.ticket;
    },
  };
}
