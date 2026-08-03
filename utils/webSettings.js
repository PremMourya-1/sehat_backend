const { WebSetting } = require("../models");

// Every site-wide setting lives in one row's JSONB `value` — adding a new
// setting later (maintenanceMode, minOrderValue, ...) is just a new key
// here and in DEFAULT_SETTINGS, never a new row or table.
const SITE_SETTINGS_KEY = "site";
const DEFAULT_SETTINGS = {
  codEnabled: true,
  // The in-app bell/drawer notification (see utils/socket.js emitNewOrder)
  // is always on regardless of these — they only gate the extra delivery
  // channels layered on top of it.
  notifications: { chromePushEnabled: true, toastPopupEnabled: true, soundEnabled: true },
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
