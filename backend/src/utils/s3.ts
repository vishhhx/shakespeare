import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";

class S3Service {
  private s3Client: S3Client;
  constructor() {
    if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.S3_BUCKET_NAME) {
      throw new Error("Missing S3 configuration in environment variables");
    }
    this.s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  private resolveBucket(bucketType: "profile" | "face" | "voice") {
    const bucketName =
      bucketType === "face"
        ? env.S3_FACE_BUCKET_NAME
        : bucketType === "voice"
          ? env.S3_VOICE_BUCKET_NAME
          : env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error(`Missing bucket configuration for ${bucketType} uploads`);
    }
    return bucketName;
  }

  /** Returns size and content type of an uploaded object, or null when it does not exist. */
  async headObject(key: string, bucketType: "profile" | "face" | "voice" = "profile") {
    try {
      const result = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.resolveBucket(bucketType), Key: key }),
      );
      return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? "" };
    } catch (error: any) {
      if (error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async signUploadUrl(key: string, contentType: string, bucketType: "profile" | "face" | "voice" = "profile") {
    const bucketName = this.resolveBucket(bucketType);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: 60 * 5, 
    });

    return url;
  }

  async signReadUrl(key: string) {
    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: 60 * 10,
    });

    return url;
  }
}

const s3Service = new S3Service();
export default s3Service;