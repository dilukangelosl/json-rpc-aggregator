import type { LoadBalancer } from "./balancer.ts";
import type { RpcPool } from "./pool.ts";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcError, LoadBalancingConfig } from "./types.ts";

/**
 * Request router that forwards JSON-RPC requests to the pool
 * Handles retries, failover, and error detection
 */
export class Router {
  private requestCount = 0;
  private successCount = 0;
  private failureCount = 0;

  constructor(
    private pool: RpcPool,
    private balancer: LoadBalancer,
    private config: LoadBalancingConfig
  ) {}

  /**
   * Route a single JSON-RPC request or batch
   */
  async route(request: JsonRpcRequest | JsonRpcRequest[]): Promise<JsonRpcResponse | JsonRpcResponse[]> {
    // Handle batch requests
    if (Array.isArray(request)) {
      return this.routeBatch(request);
    }

    // Handle single request
    return this.routeSingle(request);
  }

  /**
   * Route a single JSON-RPC request
   */
  private async routeSingle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    this.requestCount++;
    const requestId = this.requestCount;

    let lastError: Error | null = null;
    const maxAttempts = this.config.retries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const endpoint = this.balancer.selectEndpoint();

      if (!endpoint) {
        // No healthy endpoints available
        this.failureCount++;
        return this.createErrorResponse(request.id ?? null, {
          code: -32603,
          message: "All RPC endpoints unavailable",
          data: {
            aggregator: true,
            retriesExhausted: true,
            healthyEndpoints: this.pool.getHealthyCount(),
          },
        });
      }

      try {
        const startTime = Date.now();
        const response = await this.forwardRequest(endpoint.url, request);
        const duration = Date.now() - startTime;

        // Check if response contains an error
        if (response.error) {
          // Check if it's a rate limit error
          if (this.isRateLimitError(response.error)) {
            console.log(JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "warn",
              message: "Rate limit detected",
              rpc: endpoint.url,
              method: request.method,
              errorCode: response.error.code,
            }));

            this.pool.recordFailure(endpoint.url);
            
            // Retry with different endpoint
            if (attempt < maxAttempts) {
              await this.sleep(this.config.retryDelay);
              continue;
            }
          }

          // Other RPC errors - pass through to client
          this.successCount++;
          this.pool.recordSuccess(endpoint.url, duration);
          
          console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "info",
            message: "Request completed with RPC error",
            method: request.method,
            rpc: endpoint.url,
            duration,
            attempt,
            requestId,
            errorCode: response.error.code,
          }));

          return response;
        }

        // Success
        this.successCount++;
        this.pool.recordSuccess(endpoint.url, duration);

        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Request completed",
          method: request.method,
          rpc: endpoint.url,
          duration,
          attempt,
          requestId,
        }));

        return response;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.pool.recordFailure(endpoint.url);

        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warn",
          message: "Request failed",
          method: request.method,
          rpc: endpoint.url,
          attempt,
          maxAttempts,
          error: lastError.message,
          requestId,
        }));

        // Retry with delay
        if (attempt < maxAttempts) {
          await this.sleep(this.config.retryDelay);
        }
      }
    }

    // All retries exhausted
    this.failureCount++;
    return this.createErrorResponse(request.id ?? null, {
      code: -32603,
      message: "Request failed after all retries",
      data: {
        aggregator: true,
        retriesExhausted: true,
        lastError: lastError?.message,
      },
    });
  }

  /**
   * Route a batch of JSON-RPC requests
   */
  private async routeBatch(requests: JsonRpcRequest[]): Promise<JsonRpcResponse[]> {
    // Execute all requests in parallel
    const promises = requests.map(req => this.routeSingle(req));
    return Promise.all(promises);
  }

  /**
   * Forward a request to a specific RPC endpoint
   */
  private async forwardRequest(url: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data || typeof data !== "object") {
        throw new Error("Invalid JSON-RPC response: not an object");
      }

      // Check for result or error
      if (!("result" in data) && !("error" in data)) {
        throw new Error("Invalid JSON-RPC response: missing result or error");
      }

      return data as JsonRpcResponse;

    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Check if an error is a rate limit error
   */
  private isRateLimitError(error: JsonRpcError): boolean {
    // Check error code
    if (error.code === -32005 || error.code === -32016) {
      return true;
    }

    // Check error message
    const message = error.message?.toLowerCase() || "";
    return message.includes("rate limit") || message.includes("too many requests");
  }

  /**
   * Create a JSON-RPC error response
   */
  private createErrorResponse(id: string | number | null, error: JsonRpcError): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      error,
      id,
    };
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get router statistics
   */
  getStats() {
    return {
      totalRequests: this.requestCount,
      successfulRequests: this.successCount,
      failedRequests: this.failureCount,
    };
  }
}
