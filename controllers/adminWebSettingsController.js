const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { getSiteSettings, updateSiteSettings } = require("../utils/webSettings");

// GET /api/admin/web-settings
exports.getWebSettings = asyncHandler(async (req, res) => {
  const settings = await getSiteSettings();
  return sendSuccess(res, settings);
});

// PUT /api/admin/web-settings  { codEnabled?, mobileVerificationRequired?, notifications?: { chromePushEnabled?, toastPopupEnabled?, soundEnabled? }, mixWeightIncrementsGrams?: number[] }
exports.updateWebSettings = asyncHandler(async (req, res) => {
  const { codEnabled, mobileVerificationRequired, notifications, mixWeightIncrementsGrams } = req.body;
  const patch = {};
  if (codEnabled !== undefined) patch.codEnabled = Boolean(codEnabled);
  if (mobileVerificationRequired !== undefined) patch.mobileVerificationRequired = Boolean(mobileVerificationRequired);

  if (mixWeightIncrementsGrams !== undefined) {
    if (!Array.isArray(mixWeightIncrementsGrams) || mixWeightIncrementsGrams.length === 0) {
      return sendError(res, "mixWeightIncrementsGrams must be a non-empty array", 400);
    }
    const values = mixWeightIncrementsGrams.map(Number);
    if (values.some((v) => !Number.isInteger(v) || v <= 0)) {
      return sendError(res, "Each weight increment must be a positive whole number of grams", 400);
    }
    patch.mixWeightIncrementsGrams = [...new Set(values)].sort((a, b) => a - b);
  }

  // `notifications` is a nested object — updateSiteSettings's merge-patch is
  // shallow, so a partial toggle here (just soundEnabled, say) would
  // otherwise wipe the other two. Merge it against current values first.
  if (notifications !== undefined) {
    const current = await getSiteSettings();
    patch.notifications = { ...current.notifications, ...notifications };
  }

  const settings = await updateSiteSettings(patch);
  return sendSuccess(res, settings, "Settings updated successfully");
});
