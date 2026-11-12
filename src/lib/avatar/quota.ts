/**
 * 分身每日提问上限（展示用）。实际预留、派发与结算由 lib/ai/call-control 与数据库
 * reserve_ai_call / dispatch_ai_call / finish_ai_call 执行，此处不再保留旧的配额函数。
 */
export const DAILY_LIMIT = { subscriber: 100, registered: 20, anonymous: 5 } as const;
