import { v2 as defaultCloudinaryClient } from "cloudinary";

export const DEFAULT_CLOUDINARY_CAMPAIGN_FOLDER = "crm-marketing/campaigns";
const STANDARD_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

function cloudinaryError(message, statusCode = 502, cause = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (cause) error.cause = cause;
  return error;
}

function requiredEnvironmentValue(env, name) {
  const value = String(env[name] || "").trim();
  if (!value || /^<[^>]+>$/.test(value)) {
    throw cloudinaryError(`${name} is required for campaign media uploads.`, 503);
  }
  return value;
}

function optionalEnvironmentValue(env, name) {
  const value = String(env[name] || "").trim();
  if (/^<[^>]+>$/.test(value)) {
    throw cloudinaryError(`${name} still contains a placeholder.`, 503);
  }
  return value;
}

function campaignFolder(env) {
  const value = optionalEnvironmentValue(env, "CLOUDINARY_CAMPAIGN_FOLDER") ||
    DEFAULT_CLOUDINARY_CAMPAIGN_FOLDER;
  const normalized = value.replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.includes("..") || !/^[A-Za-z0-9_ ./-]+$/.test(normalized)) {
    throw cloudinaryError("CLOUDINARY_CAMPAIGN_FOLDER is invalid.", 503);
  }
  return normalized;
}

export function cloudinaryCampaignConfiguration(env = process.env) {
  return {
    cloudName: requiredEnvironmentValue(env, "CLOUDINARY_CLOUD_NAME"),
    apiKey: requiredEnvironmentValue(env, "CLOUDINARY_API_KEY"),
    apiSecret: requiredEnvironmentValue(env, "CLOUDINARY_API_SECRET"),
    folder: campaignFolder(env),
    uploadPreset: optionalEnvironmentValue(env, "CLOUDINARY_UPLOAD_PRESET") || null,
  };
}

function configureClient(client, configuration) {
  client.config({
    cloud_name: configuration.cloudName,
    api_key: configuration.apiKey,
    api_secret: configuration.apiSecret,
    secure: true,
  });
  return client;
}

function validSecureUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && !parsed.username && !parsed.password;
}

export function normalizeCloudinaryUploadResult(result, expected) {
  const assetId = String(result?.asset_id || "").trim();
  const publicId = String(result?.public_id || "").trim();
  const resourceType = String(result?.resource_type || "").trim().toLowerCase();
  const format = String(result?.format || "").trim().toLowerCase();
  const size = Number(result?.bytes);
  const mediaUrl = String(result?.secure_url || "").trim();

  if (!assetId || assetId.length > 255 || !publicId || publicId.length > 512) {
    throw cloudinaryError("Cloudinary did not return valid asset identifiers.");
  }
  if (!new Set(["image", "video"]).has(resourceType) || resourceType !== expected.mediaType) {
    throw cloudinaryError("Cloudinary returned an unexpected campaign media resource type.");
  }
  if (!format || format.length > 32 || !Number.isInteger(size) || size < 1) {
    throw cloudinaryError("Cloudinary did not return valid campaign media metadata.");
  }
  if (!validSecureUrl(mediaUrl)) {
    throw cloudinaryError("Cloudinary did not return a valid secure_url.");
  }

  return { assetId, publicId, resourceType, format, size, mediaUrl };
}

function uploadOptions(configuration, originalName) {
  const options = {
    resource_type: "auto",
    type: "upload",
    folder: configuration.folder,
    use_filename: true,
    unique_filename: true,
    overwrite: false,
    filename_override: originalName,
    context: { original_filename: originalName },
  };
  if (configuration.uploadPreset) options.upload_preset = configuration.uploadPreset;
  return options;
}

function streamUpload(uploader, method, bytes, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (error && !settled) {
        settled = true;
        reject(error);
        return;
      }
      if (!error && result?.done !== false && !settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      const stream = uploader[method](options, finish);
      stream.on?.("error", (error) => finish(error));
      stream.end(bytes);
    } catch (error) {
      finish(error);
    }
  });
}

export async function uploadCampaignMediaToCloudinary(input, {
  env = process.env,
  client = defaultCloudinaryClient,
} = {}) {
  const configuration = cloudinaryCampaignConfiguration(env);
  const cloudinary = configureClient(client, configuration);
  const method = input.sizeBytes > STANDARD_UPLOAD_MAX_BYTES &&
    typeof cloudinary.uploader.upload_chunked_stream === "function"
    ? "upload_chunked_stream"
    : "upload_stream";
  try {
    const result = await streamUpload(
      cloudinary.uploader,
      method,
      input.bytes,
      uploadOptions(configuration, input.originalName),
    );
    return normalizeCloudinaryUploadResult(result, input);
  } catch (error) {
    if (Number.isInteger(error?.statusCode)) throw error;
    throw cloudinaryError("Cloudinary could not upload the campaign media.", 502, error);
  }
}

export async function deleteCampaignMediaFromCloudinary(reference, {
  env = process.env,
  client = defaultCloudinaryClient,
} = {}) {
  const publicId = String(reference?.publicId || reference?.cloudinaryPublicId || "").trim();
  const resourceType = String(reference?.resourceType || reference?.cloudinaryResourceType || "")
    .trim()
    .toLowerCase();
  if (!publicId || publicId.length > 512 || !new Set(["image", "video"]).has(resourceType)) {
    throw cloudinaryError("Cloudinary public_id and resource_type are required to delete campaign media.", 400);
  }
  const configuration = cloudinaryCampaignConfiguration(env);
  const cloudinary = configureClient(client, configuration);
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: "upload",
      invalidate: true,
    });
    if (!["ok", "not found"].includes(String(result?.result || "").toLowerCase())) {
      throw cloudinaryError("Cloudinary did not confirm campaign media deletion.");
    }
    return String(result.result).toLowerCase() === "ok";
  } catch (error) {
    if (Number.isInteger(error?.statusCode)) throw error;
    throw cloudinaryError("Cloudinary could not delete the campaign media.", 502, error);
  }
}
