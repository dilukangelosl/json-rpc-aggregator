import { loadConfig } from "./src/config.ts";
import { RpcPool } from "./src/pool.ts";
import { createLoadBalancer } from "./src/balancer.ts";
import { HealthChecker } from "./src/health.ts";
import { Router } from "./src/router.ts";
import { Server } from "./src/server.ts";

/**
 * Main application entry point
 */
async function main() {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    message: "Starting JSON-RPC Aggregator",
  }));

  try {
    // Load configuration
    const config = await loadConfig();
    
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Configuration loaded",
      strategy: config.loadBalancing.strategy,
      rpcCount: config.rpcs.length,
      port: config.server.port,
    }));

    // Initialize RPC pool
    const pool = new RpcPool(config.rpcs);

    // Create load balancer
    const balancer = createLoadBalancer(config.loadBalancing.strategy, pool);

    // Create router
    const router = new Router(pool, balancer, config.loadBalancing);

    // Create server
    const server = new Server(router, pool, config.server);

    // Start health checker
    const healthChecker = new HealthChecker(pool, config.healthCheck);
    healthChecker.start();

    // Start server
    server.start();

    // Graceful shutdown
    const shutdown = () => {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Shutting down gracefully",
      }));

      healthChecker.stop();
      server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      message: "Failed to start application",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
  }
}

// Start the application
main();