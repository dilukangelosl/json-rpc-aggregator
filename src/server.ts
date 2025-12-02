import type { Router } from "./router.ts";
import type { RpcPool } from "./pool.ts";
import type { ServerConfig, JsonRpcRequest, JsonRpcResponse, AggregatorStats, RpcConfig } from "./types.ts";

/**
 * HTTP server using Bun.serve()
 * Handles JSON-RPC requests and admin endpoints
 */
export class Server {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private startTime = Date.now();

  constructor(
    private router: Router,
    private pool: RpcPool,
    private config: ServerConfig
  ) {}

  /**
   * Start the HTTP server
   */
  start(): void {
    this.server = Bun.serve({
      port: this.config.port,
      hostname: this.config.host,
      fetch: this.handleRequest.bind(this),
    });

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Server started",
      port: this.config.port,
      host: this.config.host,
      url: `http://${this.config.host}:${this.config.port}`,
    }));
  }

  /**
   * Stop the HTTP server
   */
  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Server stopped",
      }));
    }
  }

  /**
   * Main request handler
   */
  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle OPTIONS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // Admin endpoints
      if (path === "/health" && method === "GET") {
        return this.handleHealth(corsHeaders);
      }

      if (path === "/stats" && method === "GET") {
        return this.handleStats(corsHeaders);
      }

      if (path === "/rpcs" && method === "GET") {
        return this.handleGetRpcs(corsHeaders);
      }

      if (path === "/rpcs" && method === "POST") {
        return this.handleAddRpc(req, corsHeaders);
      }

      if (path.startsWith("/rpcs/") && method === "DELETE") {
        const url = decodeURIComponent(path.substring(6));
        return this.handleRemoveRpc(url, corsHeaders);
      }

      // Main JSON-RPC proxy endpoint
      if (path === "/" && method === "POST") {
        return this.handleJsonRpc(req, corsHeaders);
      }

      // Not found
      return new Response("Not Found", { 
        status: 404, 
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });

    } catch (error) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Request handler error",
        error: error instanceof Error ? error.message : String(error),
        path,
        method,
      }));

      return new Response(JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Handle JSON-RPC requests
   */
  private async handleJsonRpc(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
    try {
      const body = await req.text();
      
      // Parse request
      let request: JsonRpcRequest | JsonRpcRequest[];
      try {
        request = JSON.parse(body);
      } catch {
        return this.jsonResponse({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error",
          },
          id: null,
        }, 200, corsHeaders);
      }

      // Validate JSON-RPC format
      if (!this.isValidJsonRpc(request)) {
        return this.jsonResponse({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request",
          },
          id: null,
        }, 200, corsHeaders);
      }

      // Route the request
      const response = await this.router.route(request);

      return this.jsonResponse(response, 200, corsHeaders);

    } catch (error) {
      return this.jsonResponse({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : String(error),
        },
        id: null,
      }, 200, corsHeaders);
    }
  }

  /**
   * Handle health check endpoint
   */
  private handleHealth(corsHeaders: Record<string, string>): Response {
    const healthyCount = this.pool.getHealthyCount();
    const totalCount = this.pool.getTotalCount();
    const isHealthy = healthyCount > 0;

    return this.jsonResponse({
      status: isHealthy ? "healthy" : "unhealthy",
      healthyRpcs: healthyCount,
      totalRpcs: totalCount,
      uptime: Date.now() - this.startTime,
    }, isHealthy ? 200 : 503, corsHeaders);
  }

  /**
   * Handle stats endpoint
   */
  private handleStats(corsHeaders: Record<string, string>): Response {
    const routerStats = this.router.getStats();
    const rpcStats = this.pool.getStats();

    const stats: AggregatorStats = {
      totalRequests: routerStats.totalRequests,
      successfulRequests: routerStats.successfulRequests,
      failedRequests: routerStats.failedRequests,
      healthyRpcs: this.pool.getHealthyCount(),
      totalRpcs: this.pool.getTotalCount(),
      uptime: Date.now() - this.startTime,
      rpcs: rpcStats,
    };

    return this.jsonResponse(stats, 200, corsHeaders);
  }

  /**
   * Handle get RPCs endpoint
   */
  private handleGetRpcs(corsHeaders: Record<string, string>): Response {
    const rpcs = this.pool.getStats();
    return this.jsonResponse({ rpcs }, 200, corsHeaders);
  }

  /**
   * Handle add RPC endpoint
   */
  private async handleAddRpc(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
    try {
      const body = await req.json() as RpcConfig;
      
      if (!body.url || !body.url.startsWith("http")) {
        return this.jsonResponse({
          error: "Invalid RPC URL",
        }, 400, corsHeaders);
      }

      this.pool.addEndpoint({
        url: body.url,
        weight: body.weight || 1,
      });

      return this.jsonResponse({
        success: true,
        message: "RPC added",
        url: body.url,
      }, 200, corsHeaders);

    } catch (error) {
      return this.jsonResponse({
        error: "Invalid request body",
      }, 400, corsHeaders);
    }
  }

  /**
   * Handle remove RPC endpoint
   */
  private handleRemoveRpc(url: string, corsHeaders: Record<string, string>): Response {
    const removed = this.pool.removeEndpoint(url);

    if (!removed) {
      return this.jsonResponse({
        error: "RPC not found",
      }, 404, corsHeaders);
    }

    return this.jsonResponse({
      success: true,
      message: "RPC removed",
      url,
    }, 200, corsHeaders);
  }

  /**
   * Validate JSON-RPC request format
   */
  private isValidJsonRpc(request: unknown): request is JsonRpcRequest | JsonRpcRequest[] {
    if (Array.isArray(request)) {
      return request.every(req => this.isValidSingleJsonRpc(req));
    }
    return this.isValidSingleJsonRpc(request);
  }

  /**
   * Validate single JSON-RPC request
   */
  private isValidSingleJsonRpc(request: unknown): request is JsonRpcRequest {
    if (typeof request !== "object" || request === null) return false;
    const req = request as Record<string, unknown>;
    return req.jsonrpc === "2.0" && typeof req.method === "string";
  }

  /**
   * Create JSON response
   */
  private jsonResponse(data: unknown, status: number, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
}
