const fs = require("fs");
const path = require("path");
const cloudinary = require("./cloudinary");

// Cloudinary secure_url shape:
// https://res.cloudinary.com/<cloud>/image/upload/v<version>/<folder>/<public_id>.<ext>
// The public_id Cloudinary's destroy() API wants is everything between the
// upload/v<version>/ segment and the file extension, folder included.
function extractPublicId(url) {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
  return match ? match[1] : null;
}

// Deletes a previously-uploaded image, given whatever's stored on the
// record (image/photo column) — shared by every controller that used to
// have its own copy-pasted removeUploadedFile(). Handles both a current
// Cloudinary URL and a legacy local "/uploads/..." path (data created
// before the Cloudinary migration, see utils/cloudinary.js) — best-effort
// either way and never throws, since a cleanup delete failing here should
// never block the record update/delete it's running alongside.
async function deleteUploadedImage(imageRef) {
  if (!imageRef) return;

  if (/^https?:\/\//i.test(imageRef)) {
    if (!imageRef.includes("res.cloudinary.com")) return; // not ours to delete
    const publicId = extractPublicId(imageRef);
    if (!publicId) return;
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (err) {
      console.error(`Cloudinary: failed to delete "${publicId}": ${err.message}`);
    }
    return;
  }

  // Legacy local path — most of these no longer exist on disk anyway
  // (Render's filesystem is ephemeral, see utils/cloudinary.js), but this
  // still cleans up real files in local dev.
  const base = imageRef.replace(/^\/?uploads\//, "");
  fs.unlink(path.join("uploads", base), () => {});
}

module.exports = { deleteUploadedImage };
