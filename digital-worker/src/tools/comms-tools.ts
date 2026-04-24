// ITSM Communication tools — shared across all workers
// Covers: email (Graph), Teams channel posting, date utility
// Side effects: send_email (notify), post_to_channel (notify)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { sendEmail } from '../email-service';
import { postToChannel } from '../teams-channel';

export const commsTools = [
  tool({
    name: 'send_email',
    description: 'Send an email via Microsoft Graph. NOTIFY OPERATION — confirm with user before sending. Use for escalations, notifications, and reports.',
    parameters: z.object({
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject line'),
      body: z.string().describe('Email body in HTML or plain text'),
    }),
    execute: async ({ to, subject, body }) => {
      try {
        await sendEmail(to, subject, body);
        return `Email sent to ${to} with subject "${subject}"`;
      } catch (err) {
        return `Failed to send email to ${to}: ${(err as any).message || err}`;
      }
    },
  }),

  tool({
    name: 'post_to_channel',
    description: 'Post a message to the IT Operations alerts channel in Microsoft Teams. NOTIFY OPERATION — confirm with user before posting.',
    parameters: z.object({
      message: z.string().describe('The message to post to the team channel'),
    }),
    execute: async ({ message }) => {
      try {
        await postToChannel(message, false);
        return 'Message posted to the IT Operations alerts channel';
      } catch (err) {
        return `Failed to post to channel: ${(err as any).message || err}`;
      }
    },
  }),

  tool({
    name: 'get_current_date',
    description: 'Returns the current date and time.',
    parameters: z.object({}),
    execute: async () => JSON.stringify({ isoDate: new Date().toISOString(), utcString: new Date().toUTCString() }),
  }),
];
