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
    if (!env.AWS_REGION || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_ACCESS_KEY_ID) {
      throw new Error("Missing SNS configuration in environment variables");
    }

    this.snsClient = new SNSClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
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

  async sendVerificationEmail(email: string, verificationCode: string, role: string): Promise<void> {
    if (!env.SNS_VERIFICATION_TOPIC_ARN) {
      throw new Error("Missing SNS verification topic ARN in environment variables");
    }

    const command = new PublishCommand({
      TopicArn: env.SNS_VERIFICATION_TOPIC_ARN,
      Subject: `SafeSphere verification code for ${role}`,
      Message: `Verification requested for ${email}\n\nCode: ${verificationCode}\nExpires in 5 minutes.`,
    });

    await this.snsClient.send(command);
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