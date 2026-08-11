const { ShippingZone } = require("../models");

// Resolves a delivery state to its shipping charge (see models/ShippingZone.js
// — one row per zone, each owning a list of state names). Matched
// case-insensitively since the state comes from resolvePincodeLocation()'s
// external API and casing isn't guaranteed to match what the admin typed
// into a zone.
//
// Falls back to the highest-priced zone when the state isn't mapped to any
// zone yet — safer to slightly overcharge shipping for an
// unrecognized/remote state than undercharge, and it's a loud enough signal
// (logged) that the admin should add the missing state to a zone.
async function getShippingCharge(state) {
  const zones = await ShippingZone.findAll();
  if (zones.length === 0) {
    console.error("Shipping: no shipping zones configured — returning ₹0 shipping charge");
    return 0;
  }

  const normalizedState = String(state || "").trim().toLowerCase();
  const matchedZone = zones.find((zone) =>
    (zone.states || []).some((s) => String(s).trim().toLowerCase() === normalizedState),
  );

  if (matchedZone) {
    return Number(matchedZone.shippingCharge);
  }

  const fallbackZone = zones.reduce(
    (max, zone) => (Number(zone.shippingCharge) > Number(max.shippingCharge) ? zone : max),
    zones[0],
  );
  console.warn(
    `Shipping: state "${state}" is not mapped to any shipping zone — falling back to "${fallbackZone.zoneName}" (₹${fallbackZone.shippingCharge}). Add it to a zone from Settings > Shipping Zones.`,
  );
  return Number(fallbackZone.shippingCharge);
}

module.exports = { getShippingCharge };
