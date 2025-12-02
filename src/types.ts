/**
 * Core TypeScript type definitions for the JSON-RPC Aggregator
 */

// JSON-RPC 2.0 Request
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown[] | Record<string, unknown>;
  id?: string | number | null;
}

// JSON-RPC 2.0 Response
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JsonRpcError;
  id: string | number | null;
}

// JSON-RPC 2.0 Error
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// RPC Endpoint with health metrics
export interface RpcEndpoint {
  url: string;
  weight: number;
  healthy: boolean;
  lastCheck: number;
  avgResponseTime: number;
  failureCount: number;
  successCount: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

// Load balancing strategies
export enum LoadBalanceStrategy {
  RoundRobin = "round-robin",
  WeightedRoundRobin = "weighted-round-robin",
  Random = "random",
  LatencyBased = "latency-based",
}

// Server configuration
export interface ServerConfig {
  port: number;
  host: string;
}

// Load balancing configuration
export interface LoadBalancingConfig {
  strategy: LoadBalanceStrategy;
  retries: number;
  retryDelay: number;
  timeout: number;
}

// Health check configuration
export interface HealthCheckConfig {
  enabled: boolean;
  interval: number;
  timeout: number;
  unhealthyThreshold: number;
  healthyThreshold: number;
}

// RPC configuration
export interface RpcConfig {
  url: string;
  weight: number;
}

// Complete application configuration
export interface Config {
  server: ServerConfig;
  loadBalancing: LoadBalancingConfig;
  healthCheck: HealthCheckConfig;
  rpcs: RpcConfig[];
}

// Statistics for monitoring
export interface RpcStats {
  url: string;
  healthy: boolean;
  successCount: number;
  failureCount: number;
  avgResponseTime: number;
  lastCheck: number;
}

export interface AggregatorStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  healthyRpcs: number;
  totalRpcs: number;
  uptime: number;
  rpcs: RpcStats[];
}
