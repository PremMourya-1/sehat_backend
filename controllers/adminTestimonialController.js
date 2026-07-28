const fs = require("fs");
const path = require("path");
const { Testimonial } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

function removeUploadedFile(filename) {
  if (!filename) return;
  const base = filename.replace(/^\/?uploads\//, "");
  fs.unlink(path.join("uploads", base), () => {});
}

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

// GET /api/admin/testimonials
exports.getAllTestimonials = asyncHandler(async (req, res) => {
  const testimonials = await Testimonial.findAll({ order: [["sortOrder", "ASC"]] });
  return sendSuccess(res, testimonials);
});

// POST /api/admin/testimonials  (multipart, single "image")
exports.createTestimonial = asyncHandler(async (req, res) => {
  const { name, designation, message, rating, sortOrder, status } = req.body;
  if (!name || !message) return sendError(res, "Name and message are required", 400);

  const testimonial = await Testimonial.create({
    name,
    designation,
    message,
    rating: rating || null,
    image: req.file ? `/uploads/${req.file.filename}` : null,
    sortOrder: sortOrder || 0,
    status: toBool(status, true),
  });

  return sendSuccess(res, testimonial, "Testimonial created successfully", 201);
});

// PUT /api/admin/testimonials/:id
exports.updateTestimonial = asyncHandler(async (req, res) => {
  const testimonial = await Testimonial.findByPk(req.params.id);
  if (!testimonial) return sendError(res, "Testimonial not found", 404);

  const { name, designation, message, rating, sortOrder, status } = req.body;
  if (name !== undefined) testimonial.name = name;
  if (designation !== undefined) testimonial.designation = designation;
  if (message !== undefined) testimonial.message = message;
  if (rating !== undefined) testimonial.rating = rating || null;
  if (sortOrder !== undefined) testimonial.sortOrder = sortOrder;
  if (status !== undefined) testimonial.status = toBool(status, testimonial.status);

  if (req.file) {
    removeUploadedFile(testimonial.image);
    testimonial.image = `/uploads/${req.file.filename}`;
  }

  await testimonial.save();
  return sendSuccess(res, testimonial, "Testimonial updated successfully");
});

// DELETE /api/admin/testimonials/:id
exports.deleteTestimonial = asyncHandler(async (req, res) => {
  const testimonial = await Testimonial.findByPk(req.params.id);
  if (!testimonial) return sendError(res, "Testimonial not found", 404);

  removeUploadedFile(testimonial.image);
  await testimonial.destroy();

  return sendSuccess(res, null, "Testimonial deleted successfully");
});
