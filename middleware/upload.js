const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

// See utils/cloudinary.js for why this isn't local disk storage anymore.
// req.file.path (or req.files[i].path for multi-upload) ends up holding
// the full Cloudinary secure_url — every controller that used to build
// `/uploads/${file.filename}` now just stores that path directly.
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "sehat-potli",
    resource_type: "image",
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image")) cb(null, true);
  else cb(new Error("Only image files are allowed"), false);
};

const upload = multer({ storage, fileFilter });

module.exports = upload;
