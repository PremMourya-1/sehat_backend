const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const { getSiteSettings, updateSiteSettings } = require("../utils/webSettings");

// GET /api/admin/web-settings
exports.getWebSettings = asyncHandler(async (req, res) => {
  const settings = await getSiteSettings();
  return sendSuccess(res, settings);
});

// PUT /api/admin/web-settings  { codEnabled? , ...future settings }
exports.updateWebSettings = asyncHandler(async (req, res) => {
  const { codEnabled } = req.body;
  const patch = {};
  if (codEnabled !== undefined) patch.codEnabled = Boolean(codEnabled);

  const settings = await updateSiteSettings(patch);
  return sendSuccess(res, settings, "Settings updated successfully");
});
