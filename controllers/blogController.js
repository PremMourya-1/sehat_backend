const { BlogPost } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// GET /api/blog-posts
exports.getBlogPosts = asyncHandler(async (req, res) => {
  const posts = await BlogPost.findAll({
    where: { status: true },
    order: [["sortOrder", "ASC"]],
  });
  return sendSuccess(res, posts);
});

// GET /api/blog-posts/:id
exports.getBlogPostById = asyncHandler(async (req, res) => {
  const post = await BlogPost.findOne({ where: { id: req.params.id, status: true } });
  if (!post) return sendError(res, "Blog post not found", 404);
  return sendSuccess(res, post);
});
