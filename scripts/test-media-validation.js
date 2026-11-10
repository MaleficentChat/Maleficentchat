const assert = require("node:assert/strict");
const { validateMediaFile } = require("../media-validation");

const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]);
const jpeg = Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46]);
const mp4 = Buffer.from([0x00,0x00,0x00,0x18,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d]);
const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
const webmAudio = Buffer.from([0x1a,0x45,0xdf,0xa3,0x93,0x42,0x82,0x84]);

assert.deepEqual(validateMediaFile({buffer:png,originalname:"avatar.png",mimetype:"image/png"}),{ok:true,mime:"image/png"});
assert.deepEqual(validateMediaFile({buffer:jpeg,originalname:"photo.jpg",mimetype:"image/jpeg"}),{ok:true,mime:"image/jpeg"});
assert.deepEqual(validateMediaFile({buffer:mp4,originalname:"clip.mp4",mimetype:"video/mp4"}),{ok:true,mime:"video/mp4"});
assert.equal(validateMediaFile({buffer:svg,originalname:"avatar.svg",mimetype:"image/svg+xml"}).ok,false,
  "SVG active content must not pass media validation");
assert.equal(validateMediaFile({buffer:png,originalname:"avatar.png",mimetype:"image/svg+xml"}).ok,false,
  "client-supplied MIME types must match the detected file content");
assert.equal(validateMediaFile({buffer:png,originalname:"avatar.svg",mimetype:"image/png"}).ok,false,
  "unsupported extensions must be rejected");
assert.equal(validateMediaFile({buffer:webmAudio,originalname:"voice.weba",mimetype:"audio/webm"}).ok,true,
  "WebM audio must remain supported");
console.log("Uploaded-media signature validation tests passed.");
