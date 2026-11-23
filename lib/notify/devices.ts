import { createHash } from "node:crypto";
import { deleteDoc, readDoc, updateDoc, writeDoc } from "../doc-store";

/**
 * The iPhones that get push notifications for a workspace, plus the workspace's push switch. A token
 * belongs to one workspace at a time: registering it elsewhere (another account on the same phone) moves it.
 * Each device remembers the app's OAuth grant that registered it, so disconnecting the app stops its pushes.
 */

export const MAX_DEVICES = 10;
export type PushEnvironment = "sandbox" | "production";
export type DeviceGrant = { sub: string; grantId: string };
export type Device = { token: string; environment: PushEnvironment; createdAt: number; lastSeen: number } & Partial<DeviceGrant>;
export type DeviceList = { pushEnabled: boolean; devices: Device[] };

const safeWs = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) throw new Error("Invalid workspace id");
  return id;
};
const listKey = (workspaceId: string) => `devices/${safeWs(workspaceId)}.json`;
const ownerKey = (token: string) => `device-owners/${createHash("sha256").update(token).digest("hex")}.json`;
const normalize = (cur: DeviceList | null): DeviceList => ({ pushEnabled: cur?.pushEnabled !== false, devices: cur?.devices ?? [] });

export async function readDevices(workspaceId: string): Promise<DeviceList> {
  return normalize(await readDoc<DeviceList>(listKey(workspaceId)));
}

export async function registerDevice(
  workspaceId: string,
  rawToken: string,
  environment: PushEnvironment,
  grant: DeviceGrant,
  now = Date.now(),
): Promise<DeviceList> {
  const token = rawToken.toLowerCase();
  const previous = await readDoc<{ workspaceId: string }>(ownerKey(token));
  if (previous && previous.workspaceId !== workspaceId) await dropTokens(previous.workspaceId, [token]).catch(() => undefined);
  const saved = await updateDoc<DeviceList>(listKey(workspaceId), (cur) => {
    const list = normalize(cur);
    const existing = list.devices.find((d) => d.token === token);
    const device: Device = { token, environment, sub: grant.sub, grantId: grant.grantId, createdAt: existing?.createdAt ?? now, lastSeen: now };
    const devices = [device, ...list.devices.filter((d) => d.token !== token)]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, MAX_DEVICES);
    return { ...list, devices };
  });
  await writeDoc(ownerKey(token), { workspaceId });
  return saved;
}

export async function removeDevice(workspaceId: string, rawToken: string): Promise<DeviceList> {
  const token = rawToken.toLowerCase();
  const saved = await dropTokens(workspaceId, [token]);
  const owner = await readDoc<{ workspaceId: string }>(ownerKey(token));
  if (owner?.workspaceId === workspaceId) await deleteDoc(ownerKey(token));
  return saved;
}

/** Removes tokens APNs no longer accepts (or that moved to another workspace). */
export function dropTokens(workspaceId: string, tokens: string[]): Promise<DeviceList> {
  const gone = new Set(tokens.map((t) => t.toLowerCase()));
  return updateDoc<DeviceList>(listKey(workspaceId), (cur) => {
    const list = normalize(cur);
    return { ...list, devices: list.devices.filter((d) => !gone.has(d.token)) };
  });
}

/** Saves the environment APNs actually accepted a token on (the app can report the wrong one). */
export function setEnvironments(workspaceId: string, moved: Map<string, PushEnvironment>): Promise<DeviceList> {
  return updateDoc<DeviceList>(listKey(workspaceId), (cur) => {
    const list = normalize(cur);
    return { ...list, devices: list.devices.map((d) => (moved.has(d.token) ? { ...d, environment: moved.get(d.token)! } : d)) };
  });
}

export function setPushEnabled(workspaceId: string, pushEnabled: boolean): Promise<DeviceList> {
  return updateDoc<DeviceList>(listKey(workspaceId), (cur) => ({ ...normalize(cur), pushEnabled }));
}
