
export const env = {
  MONGO_URI: process.env.MONGO_URI || "mongodb://localhost:27017/Blinkit",
  PORT: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET || "your_jwt_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ||"7d",
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
};

