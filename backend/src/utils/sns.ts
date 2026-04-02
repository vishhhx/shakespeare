import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { env } from "../config/env";

const toIndianE164 = (value: string): string => {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    const local = digits.slice(1);
    if (/^[6-9]\d{9}$/.test(local)) {
      return `+91${local}`;
    }
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    const local = digits.slice(2);
    if (/^[6-9]\d{9}$/.test(local)) {
      return `+91${local}`;
    }
  }

  throw new Error("Invalid Indian phone number format for SNS");
};

class SNSService {
  private snsClient: SNSClient;

  constructor() {
    if (
      !env.S3_REGION ||
      !env.S3_SECRET_ACCESS_KEY ||
      !env.S3_ACCESS_KEY_ID
    ) {
      throw new Error("Missing SNS configuration in environment variables");
    }

    this.snsClient = new SNSClient({
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  /**
   * Send SMS to a single phone number
   */
  async sendSMS(phoneNumber: string, message: string) {
    try {
      const normalizedPhoneNumber = toIndianE164(phoneNumber);
      const command = new PublishCommand({
        Message: message,
        PhoneNumber: normalizedPhoneNumber,
      });

      const response = await this.snsClient.send(command);
      return response;
    } catch (error) {
      console.error("SNS SMS Error:", error);
      throw error;
    }
  }

  async sendOtp(phoneNumber: string, otp: string): Promise<void> {
    await this.sendSMS(phoneNumber, `Your SafeSphere OTP is ${otp}. It expires in 5 minutes.`);
  }

  async publishToTopic(topicArn: string, message: string) {
    try {
      const command = new PublishCommand({
        Message: message,
        TopicArn: topicArn,
      });

      const response = await this.snsClient.send(command);
      return response;
    } catch (error) {
      console.error("SNS Topic Error:", error);
      throw error;
    }
  }
}

const snsService = new SNSService();
export default snsService;