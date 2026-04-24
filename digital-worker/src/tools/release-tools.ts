// ITSM Release Management tools
// ITIL 4 Practice: Release Management
// Side effects: none (all read-only queries + guidance)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const releaseTools = [
  tool({
    name: 'get_release_schedule',
    description: 'Get upcoming releases from the change schedule (normal changes in scheduled state). READ OPERATION.',
    parameters: z.object({}),
    execute: async () =>
      stringify(await mcp.callTool('get-change-requests', { type: 'normal', state: 'scheduled' })),
  }),

  tool({
    name: 'get_release_readiness',
    description: 'Check release readiness — linked changes, test status, and go/no-go assessment. READ OPERATION.',
    parameters: z.object({
      release_id: z.string().describe('Release or change request number to assess readiness for'),
    }),
    execute: async ({ release_id }) => {
      const changeData = await mcp.callTool('get-change-request', { number: release_id });
      return stringify({
        change_record: changeData,
        readiness_assessment: {
          guidance:
            'Verify the following readiness gates before approving go-live: ' +
            '1) All linked changes are approved and tested. ' +
            '2) Backout/rollback plan is documented and validated. ' +
            '3) Deployment runbook is reviewed and current. ' +
            '4) Stakeholder sign-off is obtained. ' +
            '5) Monitoring and alerting are configured for post-deployment.',
        },
      });
    },
  }),
];
