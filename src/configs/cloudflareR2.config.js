import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

// Cloudflare R2 Configuration
const r2Client = new S3Client({
  region: process.env.R2_REGION || "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

// Upload file to Cloudflare R2
export const uploadToR2 = async (file, key) => {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: "public, max-age=31536000", // 1 year cache
    });

    // Add timeout and retry logic
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Upload timeout")), 30000); // 30 seconds timeout
    });

    const uploadPromise = r2Client.send(command);

    await Promise.race([uploadPromise, timeoutPromise]);

    // Return the public URL
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    return publicUrl;
  } catch (error) {
    console.error("R2 Upload Error:", error);

    // Handle specific connection errors
    if (
      error.code === "ECONNRESET" ||
      error.code === "ENOTFOUND" ||
      error.code === "ECONNREFUSED"
    ) {
      throw new Error(
        `Connection to Cloudflare R2 failed. Please check your internet connection and R2 configuration. Error: ${error.message}`,
      );
    }

    throw new Error(`Failed to upload to R2: ${error.message}`);
  }
};

// Delete file from Cloudflare R2
export const deleteFromR2 = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });

    await r2Client.send(command);
    return true;
  } catch (error) {
    throw new Error(`Failed to delete from R2: ${error.message}`);
  }
};

// Get signed URL for file (if needed for private access)
export const getSignedUrlFromR2 = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });

    // For now, return direct URL since presigner is not available
    // In production, you might need to install @aws-sdk/s3-request-presigner
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    return publicUrl;
  } catch (error) {
    throw new Error(`Failed to get URL from R2: ${error.message}`);
  }
};

// Generate unique key for file
export const generateR2Key = (originalName, folder = "shop-settings") => {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = originalName.split(".").pop();
  return `${folder}/${timestamp}-${randomString}.${extension}`;
};

// Validate file type for logo upload
export const validateLogoFile = (file) => {
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error(
      "Invalid file type. Only JPEG, PNG, and WebP images are allowed.",
    );
  }

  if (file.size > maxSize) {
    throw new Error("File size too large. Maximum size is 5MB.");
  }

  return true;
};

export { r2Client, R2_BUCKET_NAME };
