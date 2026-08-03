const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { getRazorpayConfig, updateRazorpayModeCredentials, setRazorpayActiveMode } = require("../utils/razorpay");

const VALID_MODES = ["test", "live"];

// Never returns keySecret/webhookSecret — keyId isn't a secret, so it's the
// one field safe to show back in full (same "show plain, mask the rest"
// split Shiprocket's pickupLocation/password already used).
function toModeStatus(modeConfig = {}) {
  return {
    keyIdSet: Boolean(modeConfig.keyId),
    keyIdValue: modeConfig.keyId || null,
    keySecretSet: Boolean(modeConfig.keySecret),
    webhookSecretSet: Boolean(modeConfig.webhookSecret),
  };
}

function toResponse(config) {
  return {
    activeMode: config.activeMode,
    modes: {
      test: toModeStatus(config.test),
      live: toModeStatus(config.live),
    },
  };
}

// GET /api/admin/integrations/razorpay
exports.getRazorpaySettings = asyncHandler(async (req, res) => {
  const config = await getRazorpayConfig();
  return sendSuccess(res, toResponse(config));
});

// PUT /api/admin/integrations/razorpay
// body: { activeMode } — switch which mode is live, credentials untouched; and/or
//       { mode, config: { keyId, keySecret?, webhookSecret? } } — partial update of
//       one mode's credentials (blank secret fields keep the existing value).
// Both can be sent in the same call, but the admin UI keeps them as two
// separate actions (mode switch requires its own confirmation dialog).
exports.updateRazorpaySettings = asyncHandler(async (req, res) => {
  const { activeMode, mode, config } = req.body;

  if (activeMode === undefined && mode === undefined && config === undefined) {
    return sendError(res, "Provide activeMode, or mode + config", 400);
  }

  if (activeMode !== undefined) {
    if (!VALID_MODES.includes(activeMode)) {
      return sendError(res, `activeMode must be one of: ${VALID_MODES.join(", ")}`, 400);
    }
    await setRazorpayActiveMode(activeMode);
  }

  if (mode !== undefined || config !== undefined) {
    if (!VALID_MODES.includes(mode)) {
      return sendError(res, `mode must be one of: ${VALID_MODES.join(", ")}`, 400);
    }
    if (!config || typeof config !== "object") {
      return sendError(res, "config is required when mode is provided", 400);
    }
    await updateRazorpayModeCredentials(mode, config);
  }

  const updated = await getRazorpayConfig();
  return sendSuccess(res, toResponse(updated), "Settings updated successfully");
});
