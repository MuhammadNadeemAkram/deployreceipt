import { PolicyError } from "./policy";
export class EgressBudget {
  private window = 0;
  private totalRequests = 0;
  private totalBytes = 0;
  private peers = new Map<string, { requests: number; bytes: number }>();
  constructor(private readonly now = () => Date.now()) {}
  private refresh() {
    const window = Math.floor(this.now() / 60000);
    if (window !== this.window) {
      this.window = window;
      this.totalRequests = 0;
      this.totalBytes = 0;
      this.peers.clear();
    }
  }
  reserve(address: string) {
    this.refresh();
    let peer = this.peers.get(address) ?? { requests: 0, bytes: 0 };
    if (!this.peers.has(address)) {
      if (this.peers.size >= 120) throw new PolicyError("gateway_rate_limited");
      peer = { requests: 0, bytes: 0 };
      this.peers.set(address, peer);
    }
    if (++this.totalRequests > 120)
      throw new PolicyError("gateway_rate_limited");
    if (++peer.requests > 60) throw new PolicyError("destination_rate_limited");
    let window = this.window;
    return (bytes: number) => {
      this.refresh();
      if (this.window !== window) {
        window = this.window;
        peer = this.peers.get(address) ?? { requests: 0, bytes: 0 };
        this.peers.set(address, peer);
      }
      this.totalBytes += bytes;
      peer.bytes += bytes;
      if (this.totalBytes > 67108864 || peer.bytes > 33554432)
        throw new PolicyError("destination_byte_rate_limited");
    };
  }
}
export const sharedEgressBudget = new EgressBudget();
