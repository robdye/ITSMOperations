// ITSM Operations — Scenario runner
// Executes a JSON scenario step-by-step against a SnowInjector + signal-router.
// Step types: snow.incident | snow.change | snow.event | snow.update | wait | assert.outcome.
// Asserts run by polling SNOW + the audit-trail.

import { SnowInjector } from './snow-injector';
import { signalRouter, type Signal } from '../signal-router';
import { getRecentAuditEntries } from '../audit-trail';
import { isTagged } from '../cognition-tags';

export type ScenarioStep =
  | { type: 'snow.incident'; fields: Record<string, unknown> }
  | { type: 'snow.change'; fields: Record<string, unknown> }
  | { type: 'snow.event'; fields: Record<string, unknown> }
  | {
      type: 'snow.update';
      table: 'incident' | 'change_request' | 'em_event' | 'problem';
      sysIdFromOutput?: string;
      fields: Record<string, unknown>;
    }
  | {
      /**
       * Phase E — Publish a synthetic signal directly to the router.
       * Used by enrichment-driven scenarios where the trigger originates
       * from the MCP enrichment server rather than ServiceNow.
       */
      type: 'signal.publish';
      signal: Omit<Signal, 'id' | 'occurredAt'> & { id?: string; occurredAt?: string };
    }
  | { type: 'wait'; ms: number }
  | {
      type: 'assert.outcome';
      description: string;
      auditContains?: { workerId?: string; toolName?: string };
      signalRouted?: { workflowId: string };
      cognitionTagged?: { namespace: string; key: string };
      timeoutMs?: number;
    };

export interface Scenario {
  id: string;
  description: string;
  steps: ScenarioStep[];
  expectedOutcomes?: string[];
}

export interface ScenarioRunReport {
  scenarioId: string;
  demoRunId: string;
  passed: boolean;
  stepResults: Array<{
    index: number;
    type: ScenarioStep['type'];
    ok: boolean;
    detail?: string;
  }>;
}

export interface ScenarioRunnerOptions {
  injector: SnowInjector;
  /**
   * When the runner needs to publish a "scripted" signal directly (because
   * mock-snow is not configured to call the webhook), it falls back here.
   */
  publishSignal?: (signal: Signal) => Promise<void>;
}

export class ScenarioRunner {
  private outputs: Record<string, unknown>[] = [];

  constructor(private opts: ScenarioRunnerOptions) {}

  async run(scenario: Scenario): Promise<ScenarioRunReport> {
    const report: ScenarioRunReport = {
      scenarioId: scenario.id,
      demoRunId: this.opts.injector.getDemoRunId(),
      passed: true,
      stepResults: [],
    };

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      try {
        const detail = await this.executeStep(step);
        report.stepResults.push({ index: i, type: step.type, ok: true, detail });
      } catch (err) {
        report.passed = false;
        report.stepResults.push({
          index: i,
          type: step.type,
          ok: false,
          detail: (err as Error).message,
        });
        break;
      }
    }

    return report;
  }

  private async executeStep(step: ScenarioStep): Promise<string | undefined> {
    switch (step.type) {
      case 'snow.incident': {
        const result = await this.opts.injector.createIncident(step.fields);
        this.outputs.push(result);
        return `Created incident sys_id=${result.sys_id}`;
      }
      case 'snow.change': {
        const result = await this.opts.injector.createChangeRequest(step.fields);
        this.outputs.push(result);
        return `Created change_request sys_id=${result.sys_id}`;
      }
      case 'snow.event': {
        const result = await this.opts.injector.addEvent(step.fields);
        this.outputs.push(result);
        return `Created em_event sys_id=${result.sys_id}`;
      }
      case 'snow.update': {
        const sysId = step.sysIdFromOutput
          ? (this.outputs.find((o) => o.number === step.sysIdFromOutput)?.sys_id as string)
          : (step.fields.sys_id as string);
        if (!sysId) throw new Error(`snow.update could not resolve sys_id`);
        const result = await this.opts.injector.updateRecord(step.table, sysId, step.fields);
        return `Updated ${step.table} sys_id=${result.sys_id}`;
      }
      case 'wait':
        await new Promise((r) => setTimeout(r, step.ms));
        return `Waited ${step.ms}ms`;
      case 'signal.publish': {
        const signal: Signal = {
          id: step.signal.id ?? `scen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          occurredAt: step.signal.occurredAt ?? new Date().toISOString(),
          source: step.signal.source,
          type: step.signal.type,
          severity: step.signal.severity,
          asset: step.signal.asset,
          payload: step.signal.payload,
          correlationId: step.signal.correlationId,
          confidence: step.signal.confidence,
          predicted: step.signal.predicted,
          origin: step.signal.origin,
        };
        if (this.opts.publishSignal) {
          await this.opts.publishSignal(signal);
        } else {
          await signalRouter.publish(signal);
        }
        return `Published signal ${signal.id} (${signal.type})`;
      }
      case 'assert.outcome':
        return await this.assertOutcome(step);
      default: {
        const exhaustive: never = step;
        throw new Error(`Unknown step type: ${(exhaustive as ScenarioStep).type}`);
      }
    }
  }

  private async assertOutcome(
    step: Extract<ScenarioStep, { type: 'assert.outcome' }>,
  ): Promise<string> {
    const timeout = step.timeoutMs ?? 5000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (step.auditContains) {
        const matched = getRecentAuditEntries(200).some((e) => {
          if (step.auditContains?.workerId && e.workerId !== step.auditContains.workerId) return false;
          if (step.auditContains?.toolName && e.toolName !== step.auditContains.toolName) return false;
          return true;
        });
        if (matched) return `audit-trail asserted: ${step.description}`;
      }
      if (step.signalRouted) {
        const matched = signalRouter
          .getRecentDecisions(200)
          .some((d) => d.workflowId === step.signalRouted!.workflowId && d.matched);
        if (matched) return `signal-router asserted: ${step.description}`;
      }
      if (step.cognitionTagged) {
        if (isTagged(step.cognitionTagged.namespace, step.cognitionTagged.key)) {
          return `cognition-graph tagged: ${step.description}`;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`assert.outcome timed out: ${step.description}`);
  }
}
