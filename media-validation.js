"use strict";

const path = require("path");

const EXTENSION_MIME = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".weba": "audio/webm",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".qt": "video/quicktime"
});

function detectMediaMime(input, originalName = "", claimedMime = "") {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buffer.length < 8) return null;

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  const first6 = buffer.subarray(0, 6).toString("ascii");
  if (first6 === "GIF87a" || first6 === "GIF89a") return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";

  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "M4A " || brand === "M4B " || brand === "F4A ") return "audio/mp4";
    if (brand === "qt  ") return "video/quicktime";
    if (["isom","iso2","iso3","iso4","iso5","iso6","mp41","mp42","M4V ","avc1","dash","3gp4","3gp5"].includes(brand)) return "video/mp4";
  }

  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) {
    const ext = path.extname(String(originalName || "")).toLowerCase();
    return ext === ".weba" || String(claimedMime || "").toLowerCase() === "audio/webm"
      ? "audio/webm" : "video/webm";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") {
    return buffer.includes(Buffer.from("OpusHead")) ? "audio/ogg" : "audio/ogg";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "fLaC") return "audio/flac";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return "audio/aac";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";

  return null;
}

function validateMediaFile(file) {
  if (!file || !file.buffer) return { ok: false, error: "Upload could not be inspected." };
  const detectedMime = detectMediaMime(file.buffer, file.originalname, file.mimetype);
  if (!detectedMime) return { ok: false, error: "Unsupported file content. Upload a genuine image, audio or video file." };

  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  const extensionMime = EXTENSION_MIME[ext];
  if (extensionMime && extensionMime !== detectedMime &&
      !(ext === ".webm" && ["audio/webm","video/webm"].includes(detectedMime))) {
    return { ok: false, error: "The file extension does not match its actual content." };
  }
  if (ext && !extensionMime) return { ok: false, error: "This file extension is not supported." };

  const claimed = String(file.mimetype || "").toLowerCase();
  if (claimed && claimed !== "application/octet-stream" && claimed !== "binary/octet-stream" &&
      claimed !== detectedMime &&
      !(claimed === "audio/opus" && detectedMime === "audio/ogg") &&
      !(claimed === "application/ogg" && detectedMime === "audio/ogg")) {
    return { ok: false, error: "The file type does not match its actual content." };
  }

  return { ok: true, mime: detectedMime };
}

function mediaExtensionForMime(mime) {
  const extensions = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
    "image/webp": ".webp", "image/avif": ".avif",
    "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac",
    "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/flac": ".flac",
    "audio/webm": ".weba", "video/webm": ".webm",
    "video/mp4": ".mp4", "video/quicktime": ".mov"
  };
  return extensions[mime] || "";
}

module.exports = { detectMediaMime, validateMediaFile, mediaExtensionForMime };
