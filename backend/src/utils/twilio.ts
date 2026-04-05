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

  if (/^\+[1-9]\d{7,14}$/.test(value)) {
    return value;
  }

  throw new Error("Invalid phone number format for Twilio");
};

class TwilioService {
  private accountSid: string;
  private authToken: string;
  private fromNumber?: string;
  private messagingServiceSid?: string;

  constructor() {
    this.accountSid = env.TWILIO_SMS_ACCOUNT_SID || "";
    this.authToken = env.TWILIO_SMS_AUTH_TOKEN || "";
    this.fromNumber = env.TWILIO_SMS_FROM_NUMBER;
    this.messagingServiceSid = env.TWILIO_SMS_MESSAGING_SERVICE_SID;
  }

  private ensureConfigured() {
    if (!this.accountSid || !this.authToken || (!this.fromNumber && !this.messagingServiceSid)) {
      throw new Error(
        "Twilio SMS is not configured. Set TWILIO_SMS_ACCOUNT_SID, TWILIO_SMS_AUTH_TOKEN, and TWILIO_SMS_FROM_NUMBER (or TWILIO_SMS_MESSAGING_SERVICE_SID)",
      );
    }
  }

  async sendSMS(to: string, body: string): Promise<void> {
    this.ensureConfigured();

    const normalizedTo = toIndianE164(to);
    const form = new URLSearchParams();
    form.append("To", normalizedTo);
    if (this.fromNumber) {
      form.append("From", this.fromNumber);
    } else if (this.messagingServiceSid) {
      form.append("MessagingServiceSid", this.messagingServiceSid);
    }
    form.append("Body", body);

    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Twilio SMS failed: ${response.status} ${details}`);
    }
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    await this.sendSMS(to, `Your SafeSphere OTP is ${otp}. It expires in 5 minutes.`);
  }
}

const twilioService = new TwilioService();
export default twilioService;
