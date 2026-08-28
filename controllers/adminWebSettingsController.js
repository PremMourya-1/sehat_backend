const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { getSiteSettings, updateSiteSettings } = require("../utils/webSettings");

// GET /api/admin/web-settings
exports.getWebSettings = asyncHandler(async (req, res) => {
  const settings = await getSiteSettings();
  return sendSuccess(res, settings);
});

// PUT /api/admin/web-settings  { codEnabled?, mobileVerificationRequired?, notifications?: { chromePushEnabled?, toastPopupEnabled?, soundEnabled? }, mixWeightIncrementsGrams?: number[], cartRewardMode?: "highest"|"all", launchCountdown?: { enabled?, title?, description?, endText?, targetDate?, position? }, notificationChannel?: "email"|"whatsapp" }
exports.updateWebSettings = asyncHandler(async (req, res) => {
  const {
    codEnabled,
    mobileVerificationRequired,
    notifications,
    mixWeightIncrementsGrams,
    cartRewardMode,
    launchCountdown,
    notificationChannel,
  } = req.body;
  const patch = {};
  if (codEnabled !== undefined) patch.codEnabled = Boolean(codEnabled);
  if (mobileVerificationRequired !== undefined)
    patch.mobileVerificationRequired = Boolean(mobileVerificationRequired);

  if (notificationChannel !== undefined) {
    if (!["email", "whatsapp"].includes(notificationChannel)) {
      return sendError(res, 'notificationChannel must be "email" or "whatsapp"', 400);
    }
    patch.notificationChannel = notificationChannel;
  }

  if (mixWeightIncrementsGrams !== undefined) {
    if (
      !Array.isArray(mixWeightIncrementsGrams) ||
      mixWeightIncrementsGrams.length === 0
    ) {
      return sendError(
        res,
        "mixWeightIncrementsGrams must be a non-empty array",
        400,
      );
    }
    const values = mixWeightIncrementsGrams.map(Number);
    if (values.some((v) => !Number.isInteger(v) || v <= 0)) {
      return sendError(
        res,
        "Each weight increment must be a positive whole number of grams",
        400,
      );
    }
    patch.mixWeightIncrementsGrams = [...new Set(values)].sort((a, b) => a - b);
  }

  if (cartRewardMode !== undefined) {
    if (!["highest", "all"].includes(cartRewardMode)) {
      return sendError(res, 'cartRewardMode must be "highest" or "all"', 400);
    }
    patch.cartRewardMode = cartRewardMode;
  }

  // `notifications` is a nested object — updateSiteSettings's merge-patch is
  // shallow, so a partial toggle here (just soundEnabled, say) would
  // otherwise wipe the other two. Merge it against current values first.
  if (notifications !== undefined) {
    const current = await getSiteSettings();
    patch.notifications = { ...current.notifications, ...notifications };
  }

  // Same shallow-merge concern as `notifications` — flipping just `enabled`
  // off/on later must not wipe an already-saved title/description/date.
  if (launchCountdown !== undefined) {
    if (
      typeof launchCountdown !== "object" ||
      launchCountdown === null ||
      Array.isArray(launchCountdown)
    ) {
      return sendError(res, "launchCountdown must be an object", 400);
    }
    const { enabled, title, description, endText, targetDate, position } =
      launchCountdown;
    const current = (await getSiteSettings()).launchCountdown;
    const merged = { ...current };

    if (enabled !== undefined) merged.enabled = Boolean(enabled);
    if (title !== undefined) {
      if (typeof title !== "string")
        return sendError(res, "launchCountdown.title must be a string", 400);
      merged.title = title.slice(0, 120);
    }
    if (description !== undefined) {
      if (typeof description !== "string") {
        return sendError(
          res,
          "launchCountdown.description must be a string",
          400,
        );
      }
      merged.description = description.slice(0, 280);
    }
    if (endText !== undefined) {
      if (typeof endText !== "string")
        return sendError(res, "launchCountdown.endText must be a string", 400);
      merged.endText = endText.slice(0, 280);
    }
    if (targetDate !== undefined) {
      if (targetDate === null || targetDate === "") {
        merged.targetDate = null;
      } else {
        const parsed = new Date(targetDate);
        if (Number.isNaN(parsed.getTime())) {
          return sendError(
            res,
            "launchCountdown.targetDate must be a valid date",
            400,
          );
        }
        merged.targetDate = parsed.toISOString();
      }
    }
    if (position !== undefined) {
      if (!["below-header", "fixed-center"].includes(position)) {
        return sendError(
          res,
          'launchCountdown.position must be "below-header" or "fixed-center"',
          400,
        );
      }
      merged.position = position;
    }

    patch.launchCountdown = merged;
  }

  const settings = await updateSiteSettings(patch);
  return sendSuccess(res, settings, "Settings updated successfully");
});
