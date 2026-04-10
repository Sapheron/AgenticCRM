export const QUEUES = {
  AI_MESSAGE: 'ai.message',
  FOLLOW_UP: 'follow_up',
  REMINDER: 'reminder',
  BROADCAST: 'broadcast',
  PAYMENT_CHECK: 'payment_check',
  WARMUP_RESET: 'warmup_reset',
  CLEANUP: 'cleanup',
  MEMORY_DREAMING: 'memory_dreaming',
  LEAD_DECAY: 'lead_decay',
  DEAL_CYCLE: 'deal_cycle',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
