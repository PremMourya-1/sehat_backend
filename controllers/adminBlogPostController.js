const { BlogPost } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { deleteUploadedImage } = require("../utils/imageStorage");

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

// GET /api/admin/blog-posts
exports.getAllBlogPosts = asyncHandler(async (req, res) => {
  const posts = await BlogPost.findAll({ order: [["sortOrder", "ASC"]] });
  return sendSuccess(res, posts);
});

// POST /api/admin/blog-posts
exports.createBlogPost = asyncHandler(async (req, res) => {
  const { title, excerpt, content, readTime, status } = req.body;
  if (!title) return sendError(res, "Title is required", 400);

  const maxSort = await BlogPost.max("sortOrder");
  const post = await BlogPost.create({
    title,
    excerpt: excerpt || null,
    content: content || null,
    readTime: readTime || null,
    image: req.file ? req.file.path : null,
    sortOrder: (Number.isFinite(maxSort) ? maxSort : -1) + 1,
    status: toBool(status, true),
  });

  return sendSuccess(res, post, "Blog post created successfully", 201);
});

// PUT /api/admin/blog-posts/:id
exports.updateBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findByPk(req.params.id);
  if (!post) return sendError(res, "Blog post not found", 404);

  const { title, excerpt, content, readTime, status, sortOrder } = req.body;
  if (title !== undefined) post.title = title;
  if (excerpt !== undefined) post.excerpt = excerpt || null;
  if (content !== undefined) post.content = content || null;
  if (readTime !== undefined) post.readTime = readTime || null;
  if (status !== undefined) post.status = toBool(status, post.status);
  if (sortOrder !== undefined) post.sortOrder = Number(sortOrder);

  if (req.file) {
    if (post.image) await deleteUploadedImage(post.image);
    post.image = req.file.path;
  }

  await post.save();
  return sendSuccess(res, post, "Blog post updated successfully");
});

// DELETE /api/admin/blog-posts/:id
exports.deleteBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findByPk(req.params.id);
  if (!post) return sendError(res, "Blog post not found", 404);

  if (post.image) await deleteUploadedImage(post.image);
  await post.destroy();

  return sendSuccess(res, null, "Blog post deleted successfully");
});
