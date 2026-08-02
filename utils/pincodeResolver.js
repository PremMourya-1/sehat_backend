// Resolves an Indian pincode to its city/state using India Post's free,
// unauthenticated pincode API — no account/API key needed, unlike a
// Shiprocket-specific lookup. Used at order-creation time so the customer
// never has to type city/state themselves (see controllers/orderController.js).
const INDIA_POST_API_URL = "https://api.postalpincode.in/pincode";

// In-memory cache — module-level, same pattern as the Shiprocket token
// cache — since a pincode's city/state never changes, there's no need for
// a TTL or DB table just to avoid repeat lookups of the same pincode.
const cache = new Map();

// Returns { city, state } for a serviceable Indian pincode, or null if the
// pincode isn't recognized. Never throws for a not-found pincode — only for
// a genuine network/API failure, since "not found" is an expected outcome
// callers need to handle (e.g. reject the order with a clear message).
async function resolvePincodeLocation(pincode) {
  const key = String(pincode).trim();
  if (cache.has(key)) {
    return cache.get(key);
  }

  const res = await fetch(`${INDIA_POST_API_URL}/${key}`);
  if (!res.ok) {
    throw new Error(`Pincode lookup failed (${res.status})`);
  }

  const data = await res.json();
  const result = Array.isArray(data) ? data[0] : null;
  const postOffice = result?.Status === "Success" ? result.PostOffice?.[0] : null;

  const location = postOffice ? { city: postOffice.District, state: postOffice.State } : null;
  cache.set(key, location);
  return location;
}

module.exports = { resolvePincodeLocation };
