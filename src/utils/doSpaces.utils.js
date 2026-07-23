import s3Client from "../configs/doSpaces.config.js";
import { Upload } from "@aws-sdk/lib-storage";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import logger from "./logger.utils.js";

export const uploadImageToSpaces = async (file, folderName) => {
  if (
    !file ||
    !file.buffer ||
    !Buffer.isBuffer(file.buffer) ||
    file.buffer.length === 0
  ) {
    throw new Error("Invalid or empty file buffer provided for upload.");
  }
  if (!file.originalname) {
    throw new Error("File originalname is missing.");
  }
  if (!file.mimetype) {
    throw new Error("File mimetype is missing.");
  }

  const fileExtension = file.originalname.split(".").pop();
  const uniqueFileName = `${uuidv4()}-${Date.now()}.${fileExtension}`;
  const key = folderName ? `${folderName}/${uniqueFileName}` : uniqueFileName;

  const uploadParams = {
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: key,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    const uploader = new Upload({
      client: s3Client,
      params: uploadParams,
    });

    uploader.on("httpUploadProgress", (progress) => {
      console.log("Upload progress:", progress);
    });

    const data = await uploader.done(); // Execute the upload

    return {
      url: data.Location,
      spaceKey: data.Key,
    };
  } catch (err) {
    logger.error("DigitalOcean Spaces upload error:", err);
    throw new Error(
      `DigitalOcean Spaces upload failed: ${err.message || "Unknown error"}`
    );
  }
};

export const deleteImageFromSpaces = async (spaceKey) => {
  if (typeof spaceKey !== "string" || spaceKey.trim() === "") {
    throw new Error("A valid spaceKey must be provided for deletion.");
  }

  const deleteParams = {
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: spaceKey,
  };

  try {
    await s3Client.send(new DeleteObjectCommand(deleteParams));
    logger.info("Deleted image from DigitalOcean Spaces.", { spaceKey });
  } catch (err) {
    logger.error("DigitalOcean Spaces delete error:", err);
    throw new Error(
      `DigitalOcean Spaces delete failed: ${err.message || "Unknown error"}`
    );
  }
};
