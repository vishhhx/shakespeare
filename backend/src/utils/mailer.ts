import nodemailer from "nodemailer";
import { env } from "../config/env";

const hasEmailConfig = Boolean(env.EMAIL_USER && env.EMAIL_PASS);

const transporter = hasEmailConfig
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASS,
      },
    })
  : null;

export const sendEmergencyEmail = async (params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) => {
  if (!transporter) {
    throw new Error("Email transporter is not configured. Set EMAIL_USER and EMAIL_PASS.");
  }

  await transporter.sendMail({
    from: env.EMAIL_USER,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
};

export const canSendEmergencyEmail = () => Boolean(transporter);
