import { env } from "../config/env";
import redisService from "./redis";

// Test/dev safety switch: with NOTIFY_DRY_RUN=true no SMS or email leaves the server.
// Each would-be delivery is appended to a short-lived Redis list so integration tests can
// assert who would have been notified without contacting real people.
export const NOTIFY_DRY_RUN_KEY = "notify-dry-run:deliveries";
const DRY_RUN_TTL_SECONDS = 60 * 60;

export const isNotifyDryRun = () => env.NOTIFY_DRY_RUN;

export const recordDryRunDelivery = async (entry: {
  channel: "sms" | "email";
  to: string;
  subject?: string;
  body: string;
}) => {
  const record = JSON.stringify({ ...entry, at: new Date().toISOString() });
  try {
    await redisService.redis.rPush(NOTIFY_DRY_RUN_KEY, record);
    await redisService.redis.expire(NOTIFY_DRY_RUN_KEY, DRY_RUN_TTL_SECONDS);
  } catch (error) {
    console.warn("[notify:dry-run] could not record delivery", error);
  }
};
