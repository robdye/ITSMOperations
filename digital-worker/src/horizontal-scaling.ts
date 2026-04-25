/**
 * Horizontal Scaling — Configuration for multi-replica deployment.
 * Implements distributed locking, leader election, and stateless patterns.
 */

import { acquireLock as redisAcquireLock, releaseLock as redisReleaseLock, getRedisStatus } from './redis-store';

export interface ScalingConfig {
  minReplicas: number;
  maxReplicas: number;
  targetConcurrency: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  cooldownPeriod: number;
}

export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
  minReplicas: 1,
  maxReplicas: 10,
  targetConcurrency: 50,
  scaleUpThreshold: 0.7,
  scaleDownThreshold: 0.3,
  cooldownPeriod: 300,
};

/**
 * Distributed Lock — prevents concurrent execution of scheduled tasks.
 * Uses Redis when available, falls back to in-process lock.
 */
export class DistributedLock {
  private instanceId = `instance-${process.pid}-${Date.now()}`;

  /**
   * Attempt to acquire a lock.
   * Uses Redis-backed distributed lock via redis-store.
   * Returns true if lock acquired, false if already held.
   */
  async acquire(lockName: string, ttlMs: number = 60_000): Promise<boolean> {
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    return redisAcquireLock(lockName, ttlSeconds);
  }

  /**
   * Release a lock.
   */
  async release(lockName: string): Promise<void> {
    await redisReleaseLock(lockName);
  }

  /**
   * Execute a function under a distributed lock.
   */
  async withLock<T>(lockName: string, fn: () => Promise<T>, ttlMs: number = 60_000): Promise<T | null> {
    const acquired = await this.acquire(lockName, ttlMs);
    if (!acquired) {
      console.log(`[Lock] Could not acquire lock: ${lockName} (held by another instance)`);
      return null;
    }

    try {
      return await fn();
    } finally {
      await this.release(lockName);
    }
  }

  /**
   * Get instance identifier.
   */
  getInstanceId(): string {
    return this.instanceId;
  }
}

/**
 * Leader Election — ensures only one replica runs scheduled tasks.
 */
export class LeaderElection {
  private isLeader = false;
  private lock: DistributedLock;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(lock: DistributedLock) {
    this.lock = lock;
  }

  /**
   * Start leader election. Call this on startup.
   */
  async start(): Promise<void> {
    // Try to become leader
    this.isLeader = await this.lock.acquire('leader-election', 30_000);
    
    if (this.isLeader) {
      console.log(`[Leader] This instance is the leader: ${this.lock.getInstanceId()}`);
    } else {
      console.log(`[Leader] Another instance is leader. This instance is a follower.`);
    }

    // Heartbeat to maintain/acquire leadership
    this.heartbeatInterval = setInterval(async () => {
      this.isLeader = await this.lock.acquire('leader-election', 30_000);
    }, 15_000);
  }

  /**
   * Stop leader election.
   */
  async stop(): Promise<void> {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.isLeader) await this.lock.release('leader-election');
    this.isLeader = false;
  }

  /**
   * Check if this instance is the leader.
   */
  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Run a function only if this instance is the leader.
   */
  async runIfLeader<T>(fn: () => Promise<T>): Promise<T | null> {
    if (!this.isLeader) return null;
    return fn();
  }
}

/**
 * Container Apps scaling rule configuration.
 * Returns the KEDA scaling rule for Azure Container Apps.
 */
export function getKedaScalingRules(): Record<string, unknown> {
  return {
    scale: {
      minReplicas: DEFAULT_SCALING_CONFIG.minReplicas,
      maxReplicas: DEFAULT_SCALING_CONFIG.maxReplicas,
      rules: [
        {
          name: 'http-scaling',
          http: {
            metadata: {
              concurrentRequests: String(DEFAULT_SCALING_CONFIG.targetConcurrency),
            },
          },
        },
        {
          name: 'queue-scaling',
          custom: {
            type: 'azure-servicebus',
            metadata: {
              namespace: process.env.SERVICE_BUS_NAMESPACE || 'sb-itsm-operations',
              queueName: 'agent-tasks',
              messageCount: '5',
            },
            auth: [
              {
                secretRef: 'service-bus-connection',
                triggerParameter: 'connection',
              },
            ],
          },
        },
      ],
    },
  };
}

/**
 * Health check for scaling readiness.
 */
export function getScalingStatus(): {
  instanceId: string;
  isLeader: boolean;
  redisConnected: boolean;
  config: ScalingConfig;
} {
  // This will be wired to actual leader election instance in index.ts
  return {
    instanceId: `instance-${process.pid}`,
    isLeader: false, // Updated by leader election
    redisConnected: getRedisStatus().connected,
    config: DEFAULT_SCALING_CONFIG,
  };
}

// Export singleton lock instance
export const distributedLock = new DistributedLock();
