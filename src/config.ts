import type { Config, LoadBalanceStrategy } from "./types.ts";

/**
 * Load configuration from config.json and environment variables
 * Environment variables take precedence over config file
 */
export async function loadConfig(): Promise<Config> {
  // Load base config from file
  const configFile = Bun.file("config.json");
  const baseConfig: Config = await configFile.json();

  // Override with environment variables
  const config: Config = {
    server: {
      port: parseInt(process.env.PORT || String(baseConfig.server.port)),
      host: process.env.HOST || baseConfig.server.host,
    },
    loadBalancing: {
      strategy: (process.env.LOAD_BALANCE_STRATEGY as LoadBalanceStrategy) || baseConfig.loadBalancing.strategy,
      retries: parseInt(process.env.RETRY_COUNT || String(baseConfig.loadBalancing.retries)),
      retryDelay: baseConfig.loadBalancing.retryDelay,
      timeout: parseInt(process.env.REQUEST_TIMEOUT || String(baseConfig.loadBalancing.timeout)),
    },
    healthCheck: {
      enabled: baseConfig.healthCheck.enabled,
      interval: parseInt(process.env.HEALTH_CHECK_INTERVAL || String(baseConfig.healthCheck.interval)),
      timeout: baseConfig.healthCheck.timeout,
      unhealthyThreshold: baseConfig.healthCheck.unhealthyThreshold,
      healthyThreshold: baseConfig.healthCheck.healthyThreshold,
    },
    rpcs: baseConfig.rpcs,
  };

  // Override RPC URLs if provided via environment variable
  if (process.env.RPC_URLS) {
    const urls = process.env.RPC_URLS.split(",").map(url => url.trim());
    config.rpcs = urls.map(url => ({ url, weight: 1 }));
  }

  // Validate configuration
  validateConfig(config);

  return config;
}

/**
 * Validate configuration structure and values
 */
function validateConfig(config: Config): void {
  if (!config.server.port || config.server.port < 1 || config.server.port > 65535) {
    throw new Error(`Invalid port: ${config.server.port}`);
  }

  if (!config.server.host) {
    throw new Error("Server host is required");
  }

  if (config.loadBalancing.retries < 0) {
    throw new Error("Retries must be >= 0");
  }

  if (config.loadBalancing.timeout < 1000) {
    throw new Error("Timeout must be at least 1000ms");
  }

  if (!config.rpcs || config.rpcs.length === 0) {
    throw new Error("At least one RPC endpoint is required");
  }

  for (const rpc of config.rpcs) {
    if (!rpc.url || !rpc.url.startsWith("http")) {
      throw new Error(`Invalid RPC URL: ${rpc.url}`);
    }
    if (rpc.weight < 1) {
      throw new Error(`RPC weight must be >= 1: ${rpc.url}`);
    }
  }
}
