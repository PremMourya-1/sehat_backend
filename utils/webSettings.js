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
  notifications: {
    chromePushEnabled: true,
    toastPopupEnabled: true,
    soundEnabled: true,
  },
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
  // Pre-launch / sale hype countdown banner (see
  // Components/Common/LaunchCountdownBanner.js on the frontend, served
  // publicly and unauthenticated via GET /api/web-settings/launch-countdown
  // so it works for logged-out visitors too). Reusable for any future
  // "sale starts in..." campaign, not just the initial launch — admin just
  // edits title/description/targetDate/position and flips `enabled` again.
  // `position` is "below-header" (static bar under the header, scrolls
  // with the page) or "fixed-center" (floating card, fixed to the
  // viewport center regardless of scroll). The frontend also auto-hides
  // it the moment `targetDate` is in the past, so nothing needs to
  // happen here at launch time unless a new campaign is being set up.
  launchCountdown: {
    enabled: false,
    title: "Sehat Potli is launching soon.",
    description: "Get ready to shop goodness for every home.",
    endText: "Website launched. Welcome to Sehat Potli!",
    targetDate: null,
    position: "below-header",
  },
};

async function getSiteSettings() {
  const row = await WebSetting.findOne({
    where: { settingKey: SITE_SETTINGS_KEY },
  });
  return { ...DEFAULT_SETTINGS, ...(row?.value || {}) };
}

// Merge-patch — only the keys passed in `patch` are changed, everything
// else already stored is left untouched.
async function updateSiteSettings(patch) {
  const current = await getSiteSettings();
  const next = { ...current, ...patch };

  const row = await WebSetting.findOne({
    where: { settingKey: SITE_SETTINGS_KEY },
  });
  if (row) {
    row.value = next;
    await row.save();
  } else {
    await WebSetting.create({ settingKey: SITE_SETTINGS_KEY, value: next });
  }
  return next;
}

module.exports = { getSiteSettings, updateSiteSettings };
