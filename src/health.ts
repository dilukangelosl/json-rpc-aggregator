import type { RpcPool } from "./pool.ts";
import type { HealthCheckConfig, JsonRpcRequest, JsonRpcResponse } from "./types.ts";

/**
 * Background health checker for RPC endpoints
 * Periodically sends test requests to verify endpoint availability
 */
export class HealthChecker {
  private intervalId: Timer | null = null;
  private isRunning = false;

  constructor(
    private pool: RpcPool,
    private config: HealthCheckConfig
  ) {}

  /**
   * Start the health checker
   */
  start(): void {
    if (!this.config.enabled || this.isRunning) return;

    this.isRunning = true;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Health checker started",
      interval: this.config.interval,
    }));

    // Run initial check
    this.checkAll();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.checkAll();
    }, this.config.interval);
  }

  /**
   * Stop the health checker
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Health checker stopped",
    }));
  }

  /**
   * Check all endpoints
   */
  private async checkAll(): Promise<void> {
    const endpoints = this.pool.getAllEndpoints();
    const checks = endpoints.map(ep => this.checkEndpoint(ep.url));
    await Promise.allSettled(checks);
  }

  /**
   * Check a single endpoint
   */
  private async checkEndpoint(url: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Send a simple eth_blockNumber request as health check
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as JsonRpcResponse;

      // Check if response is valid JSON-RPC
      if (data.jsonrpc !== "2.0" || (data.error && !data.result)) {
        throw new Error(`Invalid JSON-RPC response: ${JSON.stringify(data.error)}`);
      }

      // Success - update metrics
      this.pool.recordSuccess(url, responseTime);

      const endpoint = this.pool.getEndpoint(url);
      if (!endpoint) return;

      // Mark as healthy if threshold met
      if (endpoint.consecutiveSuccesses >= this.config.healthyThreshold) {
        this.pool.markHealthy(url);
      }

    } catch (error) {
      // Failure - update metrics
      this.pool.recordFailure(url);

      const endpoint = this.pool.getEndpoint(url);
      if (!endpoint) return;

      // Mark as unhealthy if threshold met
      if (endpoint.consecutiveFailures >= this.config.unhealthyThreshold) {
        this.pool.markUnhealthy(url);
      }

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "debug",
        message: "Health check failed",
        url,
        error: error instanceof Error ? error.message : String(error),
        consecutiveFailures: endpoint.consecutiveFailures,
      }));
    }
  }
}
