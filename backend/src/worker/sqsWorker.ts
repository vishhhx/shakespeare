import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SQSClient,
  type DeleteMessageBatchRequestEntry,
} from "@aws-sdk/client-sqs";
import { env } from "../config/env";
import { PublicUserModel } from "../models/AuthpublicUser/publicUser.model";
import redisService from "../utils/redis";

const ensureAwsConfig = () => {
  if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error(
      "Missing SQS configuration. Required: S3_REGION/AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY",
    );
  }
};

const sqsClient = new SQSClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
  },
});

let isShuttingDown = false;
let isFacePolling = false;
let isVoicePolling = false;

const safeParseBody = (body: string) => {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

const unwrapEventPayload = (payload: any): any => {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const snsMessage = payload?.Message;
  if (typeof snsMessage === "string") {
    const parsed = safeParseBody(snsMessage);
    return parsed;
  }

  return payload;
};

const normalizeS3Key = (rawKey: string) => {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, " "));
  } catch {
    return rawKey;
  }
};

const extractFileKey = (payload: any): string | null => {
  const normalizedPayload = unwrapEventPayload(payload);
  const directKey = normalizedPayload?.fileKey ?? normalizedPayload?.filekey;
  if (typeof directKey === "string" && directKey.trim().length > 0) {
    return directKey.trim();
  }

  const records = Array.isArray(normalizedPayload?.Records)
    ? normalizedPayload.Records
    : [];
  const firstRecord = records[0];
  const s3Key = firstRecord?.s3?.object?.key;
  if (typeof s3Key === "string" && s3Key.trim().length > 0) {
    return normalizeS3Key(s3Key);
  }

  return null;
};

const extractEmbeddingId = (payload: any): string | null => {
  const candidates = [
    payload?.embeddingId,
    payload?.embeddingID,
    payload?.faceEmbeddingID,
    payload?.faceEmbeddingId,
    payload?.id,
    payload?.data?.embeddingId,
    payload?.data?.embeddingID,
    payload?.data?.faceEmbeddingID,
    payload?.data?.faceEmbeddingId,
    payload?.data?.id,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
};

const extractUserId = (payload: any): string | null => {
  const candidates = [
    payload?.userId,
    payload?.userID,
    payload?.data?.userId,
    payload?.data?.userID,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
};

const processFaceImage = async (fileKey: string) => {
  if (!env.REMOTE_PYTHON_SCRIPT_URL) {
    console.warn(
      "[sqs-worker] REMOTE_PYTHON_SCRIPT_URL not set, skipping face processing",
    );
    return;
  }

  const endpoint = `${env.REMOTE_PYTHON_SCRIPT_URL.replace(/\/$/, "")}/process-image`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fileKey }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[sqs-worker] remote processing failed: ${response.status} ${text}`,
    );
  }

  const rawPayload: unknown = await response.json();
  const payload: Record<string, any> =
    rawPayload && typeof rawPayload === "object"
      ? (rawPayload as Record<string, any>)
      : ({} as Record<string, any>);
  const faceEmbeddingID = extractEmbeddingId(payload);
  if (!faceEmbeddingID) {
    throw new Error(
      "[sqs-worker] face embedding id missing in remote response",
    );
  }

  const userId = extractUserId(payload) ?? fileKey.split("/").pop() ?? fileKey;
  let publicUser = await PublicUserModel.findById(userId);
  if (!publicUser) {
    publicUser = await PublicUserModel.findOne({ faceEmbeddingPhoto: fileKey });
  }
  if (!publicUser) {
    throw new Error(`[sqs-worker] public user not found for userId ${userId}`);
  }

  publicUser.faceEmbeddingID = faceEmbeddingID;
  publicUser.faceEmbeddingPhoto = fileKey;
  publicUser.isFaceProcessed = true;
  await publicUser.save();

  console.log("[sqs-worker] face embedding updated", {
    userId,
    fileKey,
    faceEmbeddingID,
  });
};

const processVoiceAudio = async (fileKey: string) => {
  if (!env.REMOTE_PYTHON_SCRIPT_URL) {
    console.warn(
      "[voice-sqs-worker] REMOTE_PYTHON_SCRIPT_URL not set, skipping voice processing",
    );
    return;
  }

  const endpoint = `${env.REMOTE_PYTHON_SCRIPT_URL.replace(/\/$/, "")}/audio`;

  const fileName = fileKey.split("/").pop() || fileKey;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filekey: fileKey, filename: fileName, fileName }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[voice-sqs-worker] remote audio processing failed: ${response.status} ${text}`,
    );
  }

  const rawPayload: unknown = await response.json();
  const payloadRecord: Record<string, any> =
    rawPayload && typeof rawPayload === "object"
      ? (rawPayload as Record<string, any>)
      : {};

  const analysisPayload = Object.assign({}, payloadRecord, {
    fileKey,
    fileName: String(payloadRecord.fileName || fileName),
    status: String(payloadRecord.status || "success"),
    processedAt: new Date().toISOString(),
  });

  await redisService.redis.set(
    `voice-analysis:${fileKey}`,
    JSON.stringify(analysisPayload),
    { EX: 60 * 60 },
  );
  await redisService.redis.set(
    `voice-analysis:${fileName}`,
    JSON.stringify(analysisPayload),
    { EX: 60 * 60 },
  );

  console.log("[voice-sqs-worker] audio processed", {
    fileKey,
    fileName,
    endpoint,
  });
};

const pollQueue = async ({
  queueUrl,
  workerTag,
  processMessage,
}: {
  queueUrl: string;
  workerTag: string;
  processMessage: (fileKey: string, body: any) => Promise<void>;
}) => {
  console.log(`[${workerTag}] started polling queue`);

  while (!isShuttingDown) {
    try {
      const receiveResponse = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 30,
          MessageAttributeNames: ["All"],
          AttributeNames: ["All"],
        }),
      );

      const messages = receiveResponse.Messages ?? [];

      if (messages.length === 0) {
        continue;
      }

      const entries: DeleteMessageBatchRequestEntry[] = [];

      for (const message of messages) {
        const body = safeParseBody(message.Body ?? "");
        let canDelete = true;

        try {
          const fileKey = extractFileKey(body);
          if (!fileKey) {
            throw new Error("fileKey/filekey missing in SQS message body");
          }
          await processMessage(fileKey, body);
        } catch (processingError) {
          canDelete = false;
          console.error(`[${workerTag}] message processing error`, {
            messageId: message.MessageId,
            error: processingError,
          });

          // If this message has been received many times, persist failure and delete
          try {
            const receiveCountStr =
              message.Attributes?.ApproximateReceiveCount ?? "1";
            const receiveCount = Number(receiveCountStr) || 1;
            const MAX_RECEIVE = 10;

            if (receiveCount >= MAX_RECEIVE) {
              console.warn(
                `[${workerTag}] message ${message.MessageId} exceeded receive count ${receiveCount}, saving to failed list and deleting`,
              );
              try {
                await redisService.redis.lPush(
                  `sqs-failed:${workerTag}`,
                  JSON.stringify({
                    messageId: message.MessageId,
                    receiptHandle: message.ReceiptHandle,
                    fileKey: extractFileKey(body),
                    receiveCount,
                    error: String(processingError),
                    body,
                    timestamp: new Date().toISOString(),
                  }),
                );
              } catch (redisErr) {
                console.error(
                  `[${workerTag}] failed to write failure to redis`,
                  redisErr,
                );
              }

              // mark for deletion so it won't be retried forever
              if (message.MessageId && message.ReceiptHandle) {
                entries.push({
                  Id: message.MessageId,
                  ReceiptHandle: message.ReceiptHandle,
                });
              }
            }
          } catch (err) {
            console.error(
              `[${workerTag}] error handling failure-count logic`,
              err,
            );
          }
        }

        console.log(`[${workerTag}] received message`, {
          messageId: message.MessageId,
          receiptHandle: message.ReceiptHandle,
          attributes: message.Attributes,
          messageAttributes: message.MessageAttributes,
          body,
        });

        if (canDelete && message.MessageId && message.ReceiptHandle) {
          entries.push({
            Id: message.MessageId,
            ReceiptHandle: message.ReceiptHandle,
          });
        }
      }

      if (entries.length > 0) {
        const deleteResponse = await sqsClient.send(
          new DeleteMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: entries,
          }),
        );

        if ((deleteResponse.Failed?.length ?? 0) > 0) {
          console.error(
            `[${workerTag}] failed to delete some messages`,
            deleteResponse.Failed,
          );
        }
      }
    } catch (error) {
      console.error(`[${workerTag}] polling error`, error);
    }
  }

  console.log(`[${workerTag}] stopped`);
};

export const startSqsWorker = async () => {
  if (isFacePolling) {
    console.log("[sqs-worker] already running");
    return;
  }

  ensureAwsConfig();

  if (!env.SQS_QUEUE_URL) {
    throw new Error("Missing SQS_QUEUE_URL for face worker");
  }

  isFacePolling = true;

  await pollQueue({
    queueUrl: env.SQS_QUEUE_URL,
    workerTag: "sqs-worker",
    processMessage: async (fileKey: string) => {
      await processFaceImage(fileKey);
    },
  });

  isFacePolling = false;
};

export const startVoiceSqsWorker = async () => {
  if (isVoicePolling) {
    console.log("[voice-sqs-worker] already running");
    return;
  }

  ensureAwsConfig();

  if (!env.SQS_VOICE_QUEUE_URL) {
    throw new Error("Missing SQS_VOICE_QUEUE_URL for voice worker");
  }

  isVoicePolling = true;

  await pollQueue({
    queueUrl: env.SQS_VOICE_QUEUE_URL,
    workerTag: "voice-sqs-worker",
    processMessage: async (fileKey: string) => {
      await processVoiceAudio(fileKey);
    },
  });

  isVoicePolling = false;
};

const handleShutdown = (signal: NodeJS.Signals) => {
  console.log(`[sqs-worker] received ${signal}, shutting down...`);
  isShuttingDown = true;
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

if (import.meta.main) {
  startSqsWorker().catch((error) => {
    console.error("[sqs-worker] fatal error", error);
    process.exit(1);
  });

  if (env.SQS_VOICE_QUEUE_URL) {
    startVoiceSqsWorker().catch((error) => {
      console.error("[voice-sqs-worker] fatal error", error);
      process.exit(1);
    });
  }
}
