const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const { getSiteSettings } = require("../utils/webSettings");

// GET /api/web-settings/launch-countdown — public, unauthenticated (needs to
// work for logged-out visitors). Only exposes the launchCountdown slice of
// WebSettings, not the whole object (cartRewardMode etc. have no business
// being public).
exports.getPublicLaunchCountdown = asyncHandler(async (req, res) => {
  const { launchCountdown } = await getSiteSettings();
  return sendSuccess(res, { launchCountdown });
});
