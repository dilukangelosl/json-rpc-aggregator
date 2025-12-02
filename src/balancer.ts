import type { RpcEndpoint } from "./types.ts";
import type { RpcPool } from "./pool.ts";

/**
 * Abstract base class for load balancing strategies
 */
export abstract class LoadBalancer {
  constructor(protected pool: RpcPool) {}

  /**
   * Select the next RPC endpoint to use
   */
  abstract selectEndpoint(): RpcEndpoint | null;
}

/**
 * Round-robin load balancing
 * Rotates through healthy endpoints sequentially
 */
export class RoundRobinBalancer extends LoadBalancer {
  private currentIndex = 0;

  selectEndpoint(): RpcEndpoint | null {
    const healthy = this.pool.getHealthyEndpoints();
    if (healthy.length === 0) return null;

    const endpoint = healthy[this.currentIndex % healthy.length];
    this.currentIndex = (this.currentIndex + 1) % healthy.length;
    return endpoint ?? null;
  }
}

/**
 * Weighted round-robin load balancing
 * Selects endpoints based on their configured weights
 */
export class WeightedRoundRobinBalancer extends LoadBalancer {
  private currentIndex = 0;
  private currentWeight = 0;

  selectEndpoint(): RpcEndpoint | null {
    const healthy = this.pool.getHealthyEndpoints();
    if (healthy.length === 0) return null;

    // Find maximum weight
    const maxWeight = Math.max(...healthy.map(ep => ep.weight));
    
    while (true) {
      this.currentIndex = (this.currentIndex + 1) % healthy.length;
      
      if (this.currentIndex === 0) {
        this.currentWeight = this.currentWeight - 1;
        if (this.currentWeight <= 0) {
          this.currentWeight = maxWeight;
        }
      }

      const endpoint = healthy[this.currentIndex];
      if (endpoint && endpoint.weight >= this.currentWeight) {
        return endpoint;
      }
    }
  }
}

/**
 * Random load balancing
 * Randomly selects from healthy endpoints
 */
export class RandomBalancer extends LoadBalancer {
  selectEndpoint(): RpcEndpoint | null {
    const healthy = this.pool.getHealthyEndpoints();
    if (healthy.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * healthy.length);
    return healthy[randomIndex] ?? null;
  }
}

/**
 * Latency-based load balancing
 * Prefers endpoints with lowest average response time
 */
export class LatencyBasedBalancer extends LoadBalancer {
  selectEndpoint(): RpcEndpoint | null {
    const healthy = this.pool.getHealthyEndpoints();
    if (healthy.length === 0) return null;

    // Sort by average response time (ascending)
    const sorted = [...healthy].sort((a, b) => {
      // If no response time data, put at end
      if (a.avgResponseTime === 0) return 1;
      if (b.avgResponseTime === 0) return -1;
      return a.avgResponseTime - b.avgResponseTime;
    });

    return sorted[0] ?? null;
  }
}

/**
 * Factory function to create the appropriate load balancer
 */
export function createLoadBalancer(strategy: string, pool: RpcPool): LoadBalancer {
  switch (strategy) {
    case "round-robin":
      return new RoundRobinBalancer(pool);
    case "weighted-round-robin":
      return new WeightedRoundRobinBalancer(pool);
    case "random":
      return new RandomBalancer(pool);
    case "latency-based":
      return new LatencyBasedBalancer(pool);
    default:
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: "Unknown load balancing strategy, using round-robin",
        strategy,
      }));
      return new RoundRobinBalancer(pool);
  }
}
