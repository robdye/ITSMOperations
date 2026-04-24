// ITSM Operations Digital Worker — Per-user conversation memory

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const conversations = new Map<string, Message[]>();
const MAX_MESSAGES = 10;
const MAX_USERS = 500; // Bound total memory to prevent unbounded growth

export function addMessage(userId: string, role: 'user' | 'assistant', content: string): void {
  // Evict oldest user if at capacity
  if (!conversations.has(userId) && conversations.size >= MAX_USERS) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, msgs] of conversations) {
      const lastTs = msgs.length > 0 ? msgs[msgs.length - 1].timestamp.getTime() : 0;
      if (lastTs < oldestTime) { oldestTime = lastTs; oldestKey = key; }
    }
    if (oldestKey) conversations.delete(oldestKey);
  }

  if (!conversations.has(userId)) conversations.set(userId, []);
  const msgs = conversations.get(userId)!;
  msgs.push({ role, content, timestamp: new Date() });
  if (msgs.length > MAX_MESSAGES) msgs.shift();
}

export function getHistory(userId: string): string {
  const msgs = conversations.get(userId) || [];
  return msgs.map(m => `${m.role}: ${m.content}`).join('\n');
}

export function clearHistory(userId: string): void {
  conversations.delete(userId);
}
