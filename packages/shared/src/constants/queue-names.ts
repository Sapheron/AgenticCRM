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
  TASK_CYCLE: 'task_cycle',
  SEQUENCE_EXECUTION: 'sequence_execution',
  CAMPAIGN_SCHEDULER: 'campaign_scheduler',
  CAMPAIGN_SEND: 'campaign_send',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
