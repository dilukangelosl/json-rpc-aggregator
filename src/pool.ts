import type { RpcEndpoint, RpcConfig, RpcStats } from "./types.ts";

/**
 * Manages the pool of RPC endpoints with health tracking
 */
export class RpcPool {
  private endpoints: Map<string, RpcEndpoint> = new Map();

  constructor(rpcs: RpcConfig[]) {
    for (const rpc of rpcs) {
      this.addEndpoint(rpc);
    }
  }

  /**
   * Add a new RPC endpoint to the pool
   */
  addEndpoint(rpc: RpcConfig): void {
    const endpoint: RpcEndpoint = {
      url: rpc.url,
      weight: rpc.weight,
      healthy: true,
      lastCheck: Date.now(),
      avgResponseTime: 0,
      failureCount: 0,
      successCount: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    };
    this.endpoints.set(rpc.url, endpoint);
  }

  /**
   * Remove an RPC endpoint from the pool
   */
  removeEndpoint(url: string): boolean {
    return this.endpoints.delete(url);
  }

  /**
   * Get a specific endpoint by URL
   */
  getEndpoint(url: string): RpcEndpoint | undefined {
    return this.endpoints.get(url);
  }

  /**
   * Get all endpoints
   */
  getAllEndpoints(): RpcEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Get only healthy endpoints
   */
  getHealthyEndpoints(): RpcEndpoint[] {
    return this.getAllEndpoints().filter(ep => ep.healthy);
  }

  /**
   * Update endpoint metrics after a successful request
   */
  recordSuccess(url: string, responseTime: number): void {
    const endpoint = this.endpoints.get(url);
    if (!endpoint) return;

    endpoint.successCount++;
    endpoint.consecutiveSuccesses++;
    endpoint.consecutiveFailures = 0;
    endpoint.lastCheck = Date.now();

    // Update average response time (exponential moving average)
    if (endpoint.avgResponseTime === 0) {
      endpoint.avgResponseTime = responseTime;
    } else {
      endpoint.avgResponseTime = endpoint.avgResponseTime * 0.8 + responseTime * 0.2;
    }
  }

  /**
   * Update endpoint metrics after a failed request
   */
  recordFailure(url: string): void {
    const endpoint = this.endpoints.get(url);
    if (!endpoint) return;

    endpoint.failureCount++;
    endpoint.consecutiveFailures++;
    endpoint.consecutiveSuccesses = 0;
    endpoint.lastCheck = Date.now();
  }

  /**
   * Mark an endpoint as unhealthy
   */
  markUnhealthy(url: string): void {
    const endpoint = this.endpoints.get(url);
    if (!endpoint) return;

    endpoint.healthy = false;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      message: "RPC marked unhealthy",
      url,
      consecutiveFailures: endpoint.consecutiveFailures,
    }));
  }

  /**
   * Mark an endpoint as healthy
   */
  markHealthy(url: string): void {
    const endpoint = this.endpoints.get(url);
    if (!endpoint) return;

    const wasUnhealthy = !endpoint.healthy;
    endpoint.healthy = true;
    endpoint.consecutiveFailures = 0;

    if (wasUnhealthy) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "RPC recovered",
        url,
        consecutiveSuccesses: endpoint.consecutiveSuccesses,
      }));
    }
  }

  /**
   * Get statistics for all endpoints
   */
  getStats(): RpcStats[] {
    return this.getAllEndpoints().map(ep => ({
      url: ep.url,
      healthy: ep.healthy,
      successCount: ep.successCount,
      failureCount: ep.failureCount,
      avgResponseTime: Math.round(ep.avgResponseTime),
      lastCheck: ep.lastCheck,
    }));
  }

  /**
   * Get count of healthy endpoints
   */
  getHealthyCount(): number {
    return this.getHealthyEndpoints().length;
  }

  /**
   * Get total count of endpoints
   */
  getTotalCount(): number {
    return this.endpoints.size;
  }
}
