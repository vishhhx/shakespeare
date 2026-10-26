export const env = {
  MONGO_URI: process.env.MONGO_URI || "mongodb://localhost:27017/SafeSphere",
  PORT: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET || "your_jwt_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  AWS_REGION: process.env.AWS_REGION || process.env.S3_REGION,
  AWS_ACCESS_KEY_ID:
    process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY:
    process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
  S3_FACE_BUCKET_NAME: process.env.S3_FACE_BUCKET_NAME,
  S3_VOICE_BUCKET_NAME: process.env.S3_VOICE_BUCKET_NAME,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  SNS_VERIFICATION_TOPIC_ARN:
    process.env.SNS_VERIFICATION_TOPIC_ARN || process.env.SNS_TOPIC_ARN,
  // Emergency calls run on SafeSphere's own SFU (media-server/). The API issues short-lived
  // media tokens signed with MEDIA_TOKEN_SECRET; the two services share MEDIA_INTERNAL_SECRET.
  MEDIA_TOKEN_SECRET: process.env.MEDIA_TOKEN_SECRET,
  MEDIA_INTERNAL_SECRET: process.env.MEDIA_INTERNAL_SECRET,
  /** URL apps use to reach the media server's signaling (wss://… in production). */
  MEDIA_SERVER_PUBLIC_URL: process.env.MEDIA_SERVER_PUBLIC_URL,
  /** URL this API uses to reach the media server's internal endpoints. */
  MEDIA_SERVER_INTERNAL_URL: process.env.MEDIA_SERVER_INTERNAL_URL || "http://127.0.0.1:4443",
  QDRANT_URL: process.env.QDRANT_URL?.trim() || "http://localhost:6333",
  QDRANT_API_KEY:
    (process.env.QDRANT_API_KEY || process.env.QDRANT_KEY || "").trim() ||
    undefined,
  QDRANT_COLLECTION_NAME:
    process.env.QDRANT_COLLECTION_NAME ||
    process.env.QDRANT_COLLECTION ||
    "faces",
  SQS_QUEUE_URL: process.env.SQS_QUEUE_URL,
  SQS_VOICE_QUEUE_URL: process.env.SQS_VOICE_QUEUE_URL,
  REMOTE_PYTHON_SCRIPT_URL: process.env.REMOTE_PYTHON_SCRIPT_URL,
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASS: process.env.EMAIL_PASS,
  /** When "true", SMS and email are recorded in Redis (see utils/notifyDryRun) instead of being sent. */
  NOTIFY_DRY_RUN: process.env.NOTIFY_DRY_RUN === "true",
};
