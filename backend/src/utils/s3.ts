import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";

class S3Service {
  private s3Client: S3Client;
  constructor() {
    if (!env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_BUCKET_NAME) {
      throw new Error("Missing S3 configuration in environment variables");
    }
    this.s3Client = new S3Client({
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async signUploadUrl(key: string, contentType: string) {
    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
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