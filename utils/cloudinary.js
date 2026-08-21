const cloudinary = require("cloudinary").v2;

// Replaces local disk storage (middleware/upload.js used to write straight
// to uploads/) for every image upload in the app — products, categories,
// hero banners, testimonials, blog posts, and customer review photos (see
// routes/adminRoutes.js and routes/productRoutes.js upload.* usages). Local
// disk storage silently lost every uploaded file on Render whenever the
// service restarted/redeployed (Render's filesystem is ephemeral — nothing
// written to disk survives a restart unless it's on an attached persistent
// disk), while the DB row referencing it lived on forever. Cloudinary is
// external, durable storage, so an upload survives any number of backend
// restarts/redeploys.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
