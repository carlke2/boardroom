import os from "node:os";

/** Interface name patterns treated as docker or virtual (not LAN for phones). */
const VIRTUAL_IFACE =
  /^(docker|br-|veth|virbr|tun|tap|tailscale|vmnet|vboxnet|cni|flannel|weave|lo$)/i;

export interface NetworkAddress {
  name: string;
  address: string;
}

/**
 * Non-internal IPv4 addresses on this machine, excluding docker/virtual ifaces.
 * Pure and testable; does not print or touch env.
 */
export function listReachableIpv4(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): NetworkAddress[] {
  const found: NetworkAddress[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries || VIRTUAL_IFACE.test(name)) continue;
    for (const entry of entries) {
      const family = entry.family;
      const isV4 = family === "IPv4" || family === 4;
      if (!isV4 || entry.internal) continue;
      found.push({ name, address: entry.address });
    }
  }
  return found.sort((a, b) => a.address.localeCompare(b.address));
}

/** Ready-to-paste URLs for phones on the same LAN. */
export function reachableAtLines(port: number, addresses = listReachableIpv4()): string[] {
  return addresses.map((item) => `Reachable at http://${item.address}:${port}`);
}
