/**
 * Change Rollback Orchestrator
 * Stateful workflow for coordinated rollback of failed changes:
 * 1. Validate rollback criteria
 * 2. Get approval from change authority
 * 3. Execute rollback steps
 * 4. Verify service restoration
 * 5. Update records
 */

import * as df from 'durable-functions';

interface RollbackInput {
  changeNumber: string;
  reason: string;
  backoutPlan: string;
  affectedCIs: string[];
}

df.app.orchestration('changeRollbackOrchestrator', function* (context: df.OrchestrationContext) {
  const input = context.df.getInput() as RollbackInput;
  const retryOptions = new df.RetryOptions(5000, 3);

  // Step 1: Validate rollback criteria
  const validation = yield context.df.callActivity('validateRollback', input);
  if (!validation.valid) {
    return { status: 'rejected', reason: validation.reason };
  }

  // Step 2: Request emergency approval
  yield context.df.callActivity('requestRollbackApproval', input);

  // Wait for approval (1-hour timeout for emergency)
  const approvalDeadline = new Date(context.df.currentUtcDateTime);
  approvalDeadline.setHours(approvalDeadline.getHours() + 1);
  
  const approval = context.df.waitForExternalEvent('rollbackApproved');
  const approvalTimeout = context.df.createTimer(approvalDeadline);
  const approvalResult = yield context.df.Task.any([approval, approvalTimeout]);

  if (approvalResult === approvalTimeout) {
    return { status: 'timeout', reason: 'Rollback approval timed out' };
  }

  // Step 3: Execute rollback
  yield context.df.callActivityWithRetry('executeRollback', retryOptions, input);

  // Step 4: Verify service restoration
  const verified = yield context.df.callActivity('verifyServiceRestoration', input.affectedCIs);

  // Step 5: Update change record
  yield context.df.callActivity('updateChangeRecord', {
    changeNumber: input.changeNumber,
    status: verified.restored ? 'rolled_back' : 'rollback_incomplete',
    verificationResult: verified,
  });

  return { status: 'completed', restored: verified.restored };
});

// Activity stubs
df.app.activity('validateRollback', { handler: async (input: any) => ({ valid: true }) });
df.app.activity('requestRollbackApproval', { handler: async (input: any) => ({ sent: true }) });
df.app.activity('executeRollback', { handler: async (input: any) => ({ executed: true }) });
df.app.activity('verifyServiceRestoration', { handler: async (cis: string[]) => ({ restored: true }) });
df.app.activity('updateChangeRecord', { handler: async (input: any) => ({ updated: true }) });
