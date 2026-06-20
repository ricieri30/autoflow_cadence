import { Queue } from "bullmq";
import IORedis from "ioredis";

export function makeQueue() {
  const connection = new IORedis({ host: process.env.REDIS_HOST, maxRetriesPerRequest: null });
  return new Queue("wa-scheduler", { connection });
}

export async function upsertRecurringScheduler(queue, recurringDoc) {
  const schedulerKey = `recurring:${recurringDoc._id}`;
  const repeatOpts = { pattern: recurringDoc.pattern, tz: recurringDoc.tz };
  if (recurringDoc.startDate) repeatOpts.startDate = recurringDoc.startDate;
  if (recurringDoc.endDate) repeatOpts.endDate = recurringDoc.endDate;
  if (recurringDoc.limit) repeatOpts.limit = recurringDoc.limit;

  await queue.upsertJobScheduler(
    schedulerKey,
    repeatOpts,
    {
      name: "send-recurring",
      data: { recurringId: String(recurringDoc._id) },
      opts: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 2000,
      },
    }
  );
}

export async function removeRecurringScheduler(queue, recurringId) {
  const schedulerKey = `recurring:${recurringId}`;
  await queue.removeJobScheduler(schedulerKey);
}
