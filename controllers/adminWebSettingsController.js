const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const { getSiteSettings, updateSiteSettings } = require("../utils/webSettings");

// GET /api/admin/web-settings
exports.getWebSettings = asyncHandler(async (req, res) => {
  const settings = await getSiteSettings();
  return sendSuccess(res, settings);
});

// PUT /api/admin/web-settings  { codEnabled?, mobileVerificationRequired?, notifications?: { chromePushEnabled?, toastPopupEnabled?, soundEnabled? } }
exports.updateWebSettings = asyncHandler(async (req, res) => {
  const { codEnabled, mobileVerificationRequired, notifications } = req.body;
  const patch = {};
  if (codEnabled !== undefined) patch.codEnabled = Boolean(codEnabled);
  if (mobileVerificationRequired !== undefined) patch.mobileVerificationRequired = Boolean(mobileVerificationRequired);

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
