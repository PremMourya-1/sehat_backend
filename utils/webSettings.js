const { WebSetting } = require("../models");

// Every site-wide setting lives in one row's JSONB `value` — adding a new
// setting later (maintenanceMode, minOrderValue, ...) is just a new key
// here and in DEFAULT_SETTINGS, never a new row or table.
const SITE_SETTINGS_KEY = "site";
const DEFAULT_SETTINGS = {
  codEnabled: true,
  // Gates the OTP-verify-your-mobile step at checkout (see
  // Components/Checkout/MobileVerification.js on the frontend and
  // controllers/mobileVerificationController.js here) — off by default
  // since no real SMS provider is configured yet (see OTP_PROVIDER in
  // .env.example). The OTP send/verify code itself is untouched and still
  // works the moment this is flipped on from the admin panel — no redeploy
  // needed either way.
  mobileVerificationRequired: false,
  // The in-app bell/drawer notification (see utils/socket.js emitNewOrder)
  // is always on regardless of these — they only gate the extra delivery
  // channels layered on top of it.
  notifications: { chromePushEnabled: true, toastPopupEnabled: true, soundEnabled: true },
  // Weight options offered as pill buttons on the Build Your Own Mix page
  // (see controllers/mixController.js, which serves this publicly) —
  // customers can only add an ingredient in one of these increments, never
  // a free-typed gram amount. Admin-editable (Settings → General), not
  // hardcoded on the frontend, so new increments don't need a redeploy.
  mixWeightIncrementsGrams: [100, 250, 500],
  // "highest" = only the single best-qualifying CartRewardTier's gift is
  // added to the order; "all" = every tier the cart's subtotal clears gets
  // its own free gift line, stacked. See utils/calculateCartRewards.js.
  cartRewardMode: "highest",
};

async function getSiteSettings() {
  const row = await WebSetting.findOne({ where: { settingKey: SITE_SETTINGS_KEY } });
  return { ...DEFAULT_SETTINGS, ...(row?.value || {}) };
}

// Merge-patch — only the keys passed in `patch` are changed, everything
// else already stored is left untouched.
async function updateSiteSettings(patch) {
  const current = await getSiteSettings();
  const next = { ...current, ...patch };

  const row = await WebSetting.findOne({ where: { settingKey: SITE_SETTINGS_KEY } });
  if (row) {
    row.value = next;
    await row.save();
  } else {
    await WebSetting.create({ settingKey: SITE_SETTINGS_KEY, value: next });
  }
  return next;
}

module.exports = { getSiteSettings, updateSiteSettings };
