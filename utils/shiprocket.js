const {
  IntegrationSetting,
  Order,
  OrderItem,
  Product,
  Customer,
} = require("../models");
const { encrypt, decrypt } = require("./encryption");
const { retryAsync } = require("./retry");
const { sendOrderOutForDeliveryEmail } = require("./email");
const { notifyOrderDispatched, notifyOrderDelivered } = require("./notifications");

const SHIPROCKET_BASE_URL = "https://apiv2.shiprocket.in/v1/external";
const INTEGRATION_KEY = "shiprocket";

// Shiprocket tokens are valid for 10 days and the login response doesn't
// echo back an expiry, so we compute one ourselves from the creation time.
// Refresh a bit early (not right at the deadline) so a slow request doesn't
// straddle the expiry moment and get rejected mid-flight.
const TOKEN_TTL_MS = 10 * 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 60 * 60 * 1000;

// In-memory token cache — module-level so it's reused across requests within
// this process. We don't persist this anywhere, so a process restart just
// triggers one fresh login(). getToken() proactively re-authenticates once
// the token is close to its computed expiry, and authenticatedRequest()
// still re-logs-in transparently if Shiprocket ever rejects the cached
// token as unauthorized before that (e.g. manual revocation).
let cachedToken = null;
let tokenCreatedAt = null;
let tokenExpiresAt = null;

function isTokenExpired() {
  return (
    !cachedToken ||
    !tokenExpiresAt ||
    Date.now() >= tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
  );
}

// Reads Shiprocket credentials from IntegrationSettings (config-driven,
// admin-panel-managed — this codebase gets cloned per client, so credentials
// must never require touching code/.env on each clone). Falls back to
// SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD from .env only when no DB row exists
// yet, and in that case persists them into the DB as a one-time seed — every
// call after that reads the DB.
async function getCredentials() {
  const setting = await IntegrationSetting.findOne({
    where: { integrationKey: INTEGRATION_KEY },
  });

  if (setting?.config?.email && setting?.config?.password) {
    return {
      email: setting.config.email,
      password: decrypt(setting.config.password),
    };
  }

  const envEmail = process.env.SHIPROCKET_EMAIL;
  const envPassword = process.env.SHIPROCKET_PASSWORD;
  if (!envEmail || !envPassword) {
    throw new Error(
      "Shiprocket is not configured — set it up from the admin panel (Integrations > Shiprocket), or set SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD in .env for first-time setup",
    );
  }

  const seededConfig = { email: envEmail, password: encrypt(envPassword) };
  if (setting) {
    setting.config = seededConfig;
    await setting.save();
  } else {
    await IntegrationSetting.create({
      integrationKey: INTEGRATION_KEY,
      config: seededConfig,
    });
  }
  console.log(
    "Shiprocket credentials seeded into IntegrationSettings from .env",
  );

  return { email: envEmail, password: envPassword };
}

// Logs in with the configured credentials and refreshes the cached token.
// Call this directly to force a fresh login; everything else should go
// through getToken()/authenticatedRequest() instead.
async function login() {
  const { email, password } = await getCredentials();

  const res = await fetch(`${SHIPROCKET_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Shiprocket login failed (${res.status}): ${text}`);
    throw new Error(`Shiprocket login failed (${res.status})`);
  }

  const data = await res.json();
  if (!data.token) {
    throw new Error("Shiprocket login response did not include a token");
  }

  cachedToken = data.token;
  tokenCreatedAt = Date.now();
  tokenExpiresAt = tokenCreatedAt + TOKEN_TTL_MS;
  console.log("Shiprocket authenticated");
  return cachedToken;
}

// Returns the cached token, proactively logging in first if there isn't one
// yet or if it's expired (or close to expiring).
async function getToken() {
  if (isTokenExpired()) {
    await login();
  }
  return cachedToken;
}

// Shiprocket's error bodies vary by endpoint — usually { message } but
// sometimes { errors: { field: [...] } } for field-level validation
// failures. Pulls out whatever's human-readable so it isn't lost.
function extractShiprocketErrorDetail(text) {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    if (parsed.message) return parsed.message;
    if (parsed.errors && typeof parsed.errors === "object") {
      const firstField = Object.values(parsed.errors)[0];
      if (Array.isArray(firstField) && firstField[0]) return firstField[0];
    }
    return text;
  } catch {
    return text;
  }
}

// Shared entry point for future Shiprocket API calls (shipments, orders,
// AWB, tracking, ...). Attaches the cached bearer token, and if Shiprocket
// responds 401 (token expired/invalidated), re-authenticates once and
// retries the request before giving up.
async function authenticatedRequest(path, options = {}) {
  const requestWithToken = (token) =>
    fetch(`${SHIPROCKET_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });

  let res = await requestWithToken(await getToken());

  if (res.status === 401) {
    res = await requestWithToken(await login());
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Shiprocket request failed (${res.status}) ${path}: ${text}`);
    // The specific reason (e.g. "Address 1 and Address 2 combined cannot be
    // less than 3 characters") used to only reach the server console —
    // folded into the thrown message here so it actually reaches
    // lastShipmentError/lastAwbError/lastLabelError and the admin UI,
    // instead of a bare, useless status code.
    const detail = extractShiprocketErrorDetail(text);
    throw new Error(detail ? `Shiprocket request failed (${res.status}): ${detail}` : `Shiprocket request failed (${res.status})`);
  }

  return res.json();
}

// Called by the admin panel right after Shiprocket credentials are saved, so
// a token already cached from the old credentials can't keep being used
// until its natural TTL expiry — the next getToken()/authenticatedRequest()
// call is forced to log in fresh.
function invalidateToken() {
  cachedToken = null;
  tokenCreatedAt = null;
  tokenExpiresAt = null;
}

// ---------------------------------------------------------------------------
// Phase 2 — shipment (order push) creation.
// ---------------------------------------------------------------------------

// The pickup location "nickname" (registered in Shiprocket's own dashboard)
// isn't a secret, so unlike email/password it isn't encrypted — just read
// alongside the rest of the integration's config, with the same DB-first,
// .env-fallback shape as getCredentials() (but kept separate from it, since
// it isn't a credential).
async function getPickupLocation() {
  const setting = await IntegrationSetting.findOne({
    where: { integrationKey: INTEGRATION_KEY },
  });
  const pickupLocation =
    setting?.config?.pickupLocation || process.env.SHIPROCKET_PICKUP_LOCATION;
  if (!pickupLocation) {
    throw new Error(
      "Shiprocket pickup location is not configured — add pickupLocation to the Shiprocket integration config, or set SHIPROCKET_PICKUP_LOCATION in .env",
    );
  }
  return pickupLocation;
}

// OrderItem.weight is a display label snapshot like "250g" / "1kg" (see
// models/OrderItem.js) — Shiprocket needs the shipment's total weight in kg.
function parseWeightToKg(weightLabel) {
  const match = /^(\d+(?:\.\d+)?)\s*(kg|g)$/i.exec(
    String(weightLabel || "").trim(),
  );
  if (!match) return 0;
  return match[2].toLowerCase() === "kg"
    ? Number(match[1])
    : Number(match[1]) / 1000;
}

// No per-product package dimensions exist in this schema yet, and Shiprocket
// requires *some* parcel size up front — this fixed small-parcel default is
// a placeholder. Swap in real Product dimensions if/when that field exists.
const DEFAULT_PARCEL_CM = { length: 10, breadth: 10, height: 10 };
const MIN_SHIPMENT_WEIGHT_KG = 0.1;

// Shiprocket push is no longer gated by the admin's operational `status` —
// it's triggered by an explicit "Generate Label" admin action instead (see
// generateLabelAndFulfill below), which is itself the confirmation that
// used to be implied by a pending->processing transition. The only real
// preconditions left: a cancelled order should never ship, and a prepaid
// order must have an actual successful payment on record.
//
// Checks customerStatus, not the vestigial `status` field above — `status`
// has no live UI control and nothing ever actually sets it to "cancelled";
// customerStatus is the field cancellation (see utils/orderCancellation.js)
// really sets, and the one every other status check in this codebase reads.
function validateOrderForShipment(order) {
  if (order.customerStatus === "cancelled") {
    return { valid: false, reason: "Order is cancelled" };
  }
  if (order.paymentMethod === "prepaid" && order.paymentStatus !== "paid") {
    return {
      valid: false,
      reason: "Prepaid order has no successful payment record",
    };
  }
  return { valid: true };
}

// No SKU field exists on Product/ProductVariant yet, so one is synthesized
// from the product + weight snapshot — swap in a real SKU column if one
// gets added later.
function buildShiprocketOrderPayload(order, pickupLocation) {
  const orderItems = order.OrderItems.map((item) => ({
    name: item.Product?.name || "Product",
    sku: `${item.productId}-${item.weight || "default"}`,
    units: item.quantity,
    selling_price: Number(item.price),
  }));

  const totalWeightKg = Math.max(
    order.OrderItems.reduce(
      (sum, item) => sum + parseWeightToKg(item.weight) * item.quantity,
      0,
    ),
    MIN_SHIPMENT_WEIGHT_KG,
  );

  return {
    order_id: order.orderNumber,
    order_date: order.createdAt.toISOString().slice(0, 19).replace("T", " "),
    pickup_location: pickupLocation,
    billing_customer_name: order.shippingName,
    billing_last_name: "",
    billing_address: order.shippingAddress,
    billing_city: order.shippingCity,
    billing_pincode: order.shippingPincode,
    billing_state: order.shippingState,
    billing_country: "India",
    billing_email: order.Customer?.email,
    billing_phone: order.shippingPhone,
    shipping_is_billing: true,
    order_items: orderItems,
    payment_method: order.paymentMethod === "cod" ? "COD" : "Prepaid",
    sub_total: Number(order.subtotal),
    length: DEFAULT_PARCEL_CM.length,
    breadth: DEFAULT_PARCEL_CM.breadth,
    height: DEFAULT_PARCEL_CM.height,
    weight: Number(totalWeightKg.toFixed(3)),
  };
}

// authenticatedRequest() only throws a plain Error with the status folded
// into its message (e.g. "Shiprocket request failed (503)") — parsed back
// out here rather than changing that error shape. No status match at all
// (a network-level failure, e.g. a timeout) is treated as transient too.
function isRetryableShiprocketError(err) {
  const match = /\((\d+)\)/.exec(err?.message || "");
  const status = match ? Number(match[1]) : null;
  return !status || status >= 500;
}

// Phase 2: pushes a confirmed order to Shiprocket as an adhoc order. Never
// throws — every failure path (validation, network, Shiprocket rejection)
// is recorded on the order and returned as { success: false, error }, so
// callers (the status-update hook today; an admin "retry" action or a cron
// job later) never need to wrap this in their own try/catch.
async function createShiprocketOrder(orderId) {
  const order = await Order.findByPk(orderId, {
    include: [
      {
        model: OrderItem,
        include: [{ model: Product, attributes: ["id", "name"] }],
      },
      { model: Customer, attributes: ["id", "email"] },
    ],
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  const validation = validateOrderForShipment(order);
  if (!validation.valid) {
    await order.update({
      lastShipmentError: `Validation failed: ${validation.reason}`,
    });
    console.error(
      `Shiprocket: skipping order ${order.orderNumber} — ${validation.reason}`,
    );
    return { success: false, error: validation.reason };
  }

  try {
    const pickupLocation = await getPickupLocation();
    const payload = buildShiprocketOrderPayload(order, pickupLocation);

    const data = await retryAsync(
      () =>
        authenticatedRequest("/orders/create/adhoc", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      { attempts: 2, delayMs: 1000, shouldRetry: isRetryableShiprocketError },
    );

    console.log("y rha order ka data ", { data });

    if (!data.order_id || !data.shipment_id) {
      throw new Error(
        data.message || "Shiprocket did not return an order/shipment id",
      );
    }

    await order.update({
      shiprocketOrderId: String(data.order_id),
      shiprocketShipmentId: String(data.shipment_id),
      shipmentStatus: "created",
      shipmentCreatedAt: new Date(),
      lastShipmentError: null,
    });

    console.log(
      `Shiprocket: order ${order.orderNumber} pushed (shipment ${data.shipment_id})`,
    );
    return { success: true, data };
  } catch (err) {
    console.error(
      `Shiprocket: failed to push order ${order.orderNumber}: ${err.message}`,
    );
    await order.update({
      shipmentStatus: "failed",
      lastShipmentError: err.message,
    });
    return { success: false, error: err.message };
  }
}

// Account-level wallet balance (Shiprocket deducts real shipping cost from
// this on every AWB assignment — see shippingCostActual above) — confirmed
// endpoint path from a real third-party Shiprocket SDK
// (github.com/Aniket-IN/laravel-shiprocket's WalletResource), since
// apidocs.shiprocket.in is the same JS-rendered SPA noted elsewhere in this
// file that can't be fetched for exact specifics. The response's exact
// field name for the balance isn't confirmed anywhere reliable either, so
// — same defensive approach as getCourierRate/getPickupDateFromResponse
// above — this checks every plausible shape rather than assuming one.
async function getWalletBalance() {
  const data = await authenticatedRequest("/account/details/wallet-balance", { method: "GET" });
  const raw =
    data?.data?.balance_amount ??
    data?.balance_amount ??
    data?.data?.wallet_balance ??
    data?.wallet_balance ??
    data?.data?.balance ??
    data?.balance;
  const balance = Number(raw);
  if (!Number.isFinite(balance)) {
    throw new Error("Shiprocket wallet-balance response didn't include a recognizable balance field");
  }
  return balance;
}

// ---------------------------------------------------------------------------
// Phase 3 — courier serviceability + AWB assignment.
// ---------------------------------------------------------------------------

// Shiprocket's serviceability API needs the pickup location's actual
// postcode, not its nickname — resolved by looking the nickname up in
// Shiprocket's own registered pickup addresses.
async function getPickupPincode() {
  const pickupLocation = await getPickupLocation();
  const data = await authenticatedRequest("/settings/company/pickup");
  const addresses = data?.data?.shipping_address || [];
  const match = addresses.find(
    (addr) =>
      String(addr.pickup_location || "")
        .trim()
        .toLowerCase() === pickupLocation.trim().toLowerCase(),
  );

  if (!match?.pin_code) {
    throw new Error(
      `Could not find a pickup pincode for Shiprocket pickup location "${pickupLocation}"`,
    );
  }
  return String(match.pin_code);
}

// Returns Shiprocket's available couriers for a delivery pincode/weight/COD
// combination, ready for selectCheapestCourier(). shipmentId isn't part of
// Shiprocket's serviceability contract itself (pickup/delivery pincode +
// weight + cod are what drive it) — kept as a parameter purely so callers
// and logs can trace which shipment a serviceability check was for.
async function checkServiceability(shipmentId, pincode, weight, codAmount) {
  const pickupPincode = await getPickupPincode();
  const query = new URLSearchParams({
    pickup_postcode: pickupPincode,
    delivery_postcode: String(pincode),
    weight: String(weight),
    cod: Number(codAmount) > 0 ? "1" : "0",
  });

  const data = await authenticatedRequest(
    `/courier/serviceability/?${query.toString()}`,
    { method: "GET" },
  );
  const couriers = data?.data?.available_courier_companies || [];

  console.log(
    `Shiprocket: serviceability for shipment ${shipmentId} (${pickupPincode} -> ${pincode}) — ${couriers.length} courier(s) available`,
  );
  return couriers;
}

// A generic parcel weight/COD amount for a pre-checkout "is my area
// serviceable" check, before there's a real cart/order to derive exact
// numbers from. Serviceability by weight bracket is coarse enough that a
// representative estimate is fine here — the real weight/amount get used
// again (more precisely) at actual order-creation time.
const DEFAULT_CHECK_WEIGHT_KG = 0.5;
const DEFAULT_CHECK_COD_AMOUNT = 500;

// Public-facing serviceability check — used before an order (or even a
// Shiprocket shipment) exists yet, e.g. a "check delivery to my pincode"
// widget on a product page. Same underlying Shiprocket call as
// checkServiceability(), just without a shipment to tie it to yet.
async function checkPincodeServiceability(
  deliveryPincode,
  weight = DEFAULT_CHECK_WEIGHT_KG,
  codAmount = DEFAULT_CHECK_COD_AMOUNT,
) {
  const couriers = await checkServiceability(
    "pincode-check",
    deliveryPincode,
    weight,
    codAmount,
  );

  const deliveryDays = couriers
    .map(getCourierEstimatedDeliveryDays)
    .filter((days) => days !== null);

  return {
    serviceable: couriers.length > 0,
    codAvailable: couriers.some((courier) => Number(courier.cod) === 1),
    // A range across all serviceable couriers, not just the cheapest one
    // that'll actually get picked at order time (selectCheapestCourier) —
    // this runs before checkout, so there's no "the" courier yet, just a
    // rough expectation to set for the customer.
    estimatedDeliveryDays: deliveryDays.length
      ? { min: Math.min(...deliveryDays), max: Math.max(...deliveryDays) }
      : null,
  };
}

// Shiprocket's field name for a courier's shipping cost has varied across
// response versions — check the known variants rather than assuming one
// (same defensive approach as the old getEstimatedDeliveryDays).
function getCourierRate(courier) {
  const raw = courier?.rate ?? courier?.freight_charge;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Infinity;
}

function sortCouriersByCheapest(courierList) {
  return [...courierList].sort((a, b) => getCourierRate(a) - getCourierRate(b));
}

// Shiprocket's field name for a courier's days-from-now delivery estimate
// has varied across response versions — check the known variants rather
// than assuming one (same defensive approach as the old
// getEstimatedDeliveryDays).
function getCourierEstimatedDeliveryDays(courier) {
  const days = Number(
    courier?.estimated_delivery_days ??
      courier?.etd_days ??
      courier?.edd ??
      courier?.estimated_delivery_time,
  );
  return Number.isFinite(days) && days > 0 ? days : null;
}

// Shiprocket's serviceability response also gives each courier an "etd" —
// an absolute date string (e.g. "Aug 26, 2026"), already computed on their
// side — preferred when present; falls back to today + the days estimate
// above otherwise.
function getCourierEstimatedDeliveryDate(courier) {
  if (courier?.etd) {
    const parsed = new Date(courier.etd);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const days = getCourierEstimatedDeliveryDays(courier);
  return days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
}

// Picks the cheapest courier (by rate/freight_charge) from a
// checkServiceability() result. Deliberately cheapest, not fastest —
// this product line runs thin margins, so shipping cost control matters
// more than shaving a day off delivery time (was selectFastestCourier,
// sorted by estimated_delivery_days, until this change).
function selectCheapestCourier(courierList) {
  if (!Array.isArray(courierList) || courierList.length === 0) {
    throw new Error("No couriers available to select from");
  }
  const cheapest = sortCouriersByCheapest(courierList)[0];
  console.log(
    `Shiprocket: selected courier "${cheapest.courier_name || cheapest.courier_company_id}" at rate ₹${getCourierRate(cheapest)}`,
  );
  return cheapest;
}

// Single AWB assignment attempt against one courier. Throws on any failure
// (HTTP-level via authenticatedRequest, or a logical failure Shiprocket
// reports inside a 200 response) — assignAWBWithRetry is what catches this
// and moves on to the next courier.
async function assignAWB(shipmentId, courier) {
  const data = await authenticatedRequest("/courier/assign/awb", {
    method: "POST",
    body: JSON.stringify({
      shipment_id: shipmentId,
      courier_id: courier.courier_company_id,
    }),
  });

  const awbData = data?.response?.data;
  if (data?.awb_assign_status !== 1 || !awbData?.awb_code) {
    const reason =
      (typeof awbData === "string" && awbData) ||
      data?.message ||
      "Shiprocket did not assign an AWB";
    throw new Error(reason);
  }

  return {
    awbCode: String(awbData.awb_code),
    courierCompanyId: String(awbData.courier_company_id ?? courier.courier_company_id),
    courierName: awbData.courier_name || "",
    // From the serviceability courier we just assigned, not the AWB
    // response itself — Shiprocket's AWB-assign response doesn't carry a
    // delivery estimate, only the serviceability check does.
    estimatedDeliveryDate: getCourierEstimatedDeliveryDate(courier),
    // Same reasoning — the AWB-assign response doesn't echo back a rate,
    // only the serviceability check does. This is the REAL amount
    // Shiprocket charges the wallet, separate from the flat ShippingZone
    // rate charged to the customer (Order.shippingCharge). getCourierRate()
    // returns Infinity as a sort-to-the-end sentinel for an unparseable
    // rate (see sortCouriersByCheapest) — never a real value to persist, so
    // that case is stored as null instead.
    shippingCostActual: Number.isFinite(getCourierRate(courier)) ? getCourierRate(courier) : null,
  };
}

const MAX_AWB_ATTEMPTS = 3;

// Tries the cheapest courier first, and on failure falls through to the
// next-cheapest — a different courier each attempt, not the same one
// retried — stopping once one succeeds, the courier list is exhausted, or
// MAX_AWB_ATTEMPTS is hit. Never throws: every outcome (success or every
// courier failing) is recorded on the order and returned as
// { success, error }, matching createShiprocketOrder()'s contract.
async function assignAWBWithRetry(shipmentId, courierList) {
  const order = await Order.findOne({
    where: { shiprocketShipmentId: String(shipmentId) },
  });
  if (!order) {
    return {
      success: false,
      error: `No order found for Shiprocket shipment ${shipmentId}`,
    };
  }

  if (!Array.isArray(courierList) || courierList.length === 0) {
    const error = "No couriers available to assign AWB";
    await order.update({ awbStatus: "failed", lastAwbError: error });
    return { success: false, error };
  }

  const couriers = sortCouriersByCheapest(courierList);
  const maxAttempts = Math.min(couriers.length, MAX_AWB_ATTEMPTS);
  const attemptedCouriers = [];
  let courierIndex = 0;
  let lastError;

  try {
    const awbResult = await retryAsync(
      async () => {
        const courier = couriers[courierIndex];
        courierIndex += 1;
        attemptedCouriers.push(
          courier.courier_name || courier.courier_company_id,
        );
        try {
          return await assignAWB(shipmentId, courier);
        } catch (err) {
          lastError = err;
          throw err;
        }
      },
      {
        attempts: maxAttempts,
        delayMs: 500,
        shouldRetry: () => courierIndex < couriers.length,
      },
    );

    await order.update({
      awbCode: awbResult.awbCode,
      courierCompanyId: awbResult.courierCompanyId,
      courierName: awbResult.courierName,
      estimatedDeliveryDate: awbResult.estimatedDeliveryDate,
      shippingCostActual: awbResult.shippingCostActual,
      awbStatus: "assigned",
      awbAssignedAt: new Date(),
      lastAwbError: null,
    });

    console.log(
      `Shiprocket: AWB ${awbResult.awbCode} assigned to order ${order.orderNumber} via ${awbResult.courierName} (tried: ${attemptedCouriers.join(", ")})`,
    );
    return { success: true, data: awbResult };
  } catch {
    const error = `All couriers failed (tried: ${attemptedCouriers.join(", ")}) — last error: ${lastError?.message}`;
    console.error(
      `Shiprocket: AWB assignment failed for order ${order.orderNumber}: ${error}`,
    );
    await order.update({ awbStatus: "failed", lastAwbError: error });
    return { success: false, error };
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — pickup scheduling.
// ---------------------------------------------------------------------------

// Shiprocket's response field names for the confirmed pickup date have
// varied across integrations/response versions — check the known variants
// rather than assuming one (same defensive approach as
// getEstimatedDeliveryDays() above).
function getPickupDateFromResponse(data) {
  const raw =
    data?.response?.pickup_scheduled_date ??
    data?.pickup_scheduled_date ??
    data?.response?.data?.pickup_scheduled_date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Shiprocket's label-generation endpoint appears to auto-queue the shipment
// for pickup as a side effect in some cases — this explicit request then
// 400s with this exact message (confirmed from a real response body:
// {"message":"Already in Pickup Queue.","status_code":400}). That's not a
// failure, it's confirmation the pickup is already scheduled — matched
// case-insensitively/substring since Shiprocket's punctuation isn't
// guaranteed stable across responses.
function isAlreadyInPickupQueueError(err) {
  return /already in pickup queue/i.test(err?.message || "");
}

// Requests a courier pickup for an already-AWB-assigned shipment. Looked up
// by shiprocketShipmentId (same lookup as assignAWBWithRetry, for
// consistency). Never throws — every failure path (order not found, network,
// Shiprocket rejection) is recorded on the order and returned as
// { success: false, error }, matching createShiprocketOrder()'s contract.
async function schedulePickup(shipmentId) {
  const order = await Order.findOne({
    where: { shiprocketShipmentId: String(shipmentId) },
  });
  if (!order) {
    return {
      success: false,
      error: `No order found for Shiprocket shipment ${shipmentId}`,
    };
  }

  try {
    const data = await retryAsync(
      () =>
        authenticatedRequest("/courier/generate/pickup", {
          method: "POST",
          body: JSON.stringify({ shipment_id: [Number(shipmentId)] }),
        }),
      { attempts: 2, delayMs: 1000, shouldRetry: isRetryableShiprocketError },
    );

    if (data?.pickup_status !== 1) {
      throw new Error(
        data?.response?.data ||
          data?.message ||
          "Shiprocket did not confirm the pickup",
      );
    }

    const pickupScheduledAt = new Date();
    await order.update({
      pickupStatus: "scheduled",
      pickupScheduledAt,
      pickupDate: getPickupDateFromResponse(data) || pickupScheduledAt,
      lastPickupError: null,
    });

    console.log(
      `Shiprocket: pickup scheduled for order ${order.orderNumber} (shipment ${shipmentId})`,
    );
    return { success: true, data };
  } catch (err) {
    if (isAlreadyInPickupQueueError(err)) {
      // The pickup IS scheduled — just not by this call. No pickup-date info
      // comes back on this error path (it's an error body, not the normal
      // success payload), so pickupDate is left as whatever it already was
      // rather than guessed at.
      await order.update({
        pickupStatus: "scheduled",
        pickupScheduledAt: new Date(),
        lastPickupError: null,
      });
      console.log(
        `Shiprocket: pickup already queued for order ${order.orderNumber} (shipment ${shipmentId}) — treating as scheduled`,
      );
      return { success: true, data: { alreadyQueued: true } };
    }

    console.error(
      `Shiprocket: pickup scheduling failed for order ${order.orderNumber}: ${err.message}`,
    );
    await order.update({
      pickupStatus: "failed",
      lastPickupError: err.message,
    });
    return { success: false, error: err.message };
  }
}

// Shiprocket has no dedicated "cancel pickup" endpoint — a scheduled pickup
// can only be aborted by cancelling the underlying order via
// POST /orders/cancel (which Shiprocket also uses to pull any pending pickup
// request). That's a bigger action than "undo the pickup" (it cancels the
// shipment/order on Shiprocket's side entirely), so this is intentionally
// not auto-wired into any flow yet — kept ready for an explicit admin
// "cancel order" action later, at which point that's the actual desired
// blast radius anyway. Looked up by shiprocketShipmentId for the same
// consistency as schedulePickup()/assignAWBWithRetry().
async function cancelPickup(shipmentId) {
  const order = await Order.findOne({
    where: { shiprocketShipmentId: String(shipmentId) },
  });
  if (!order) {
    return {
      success: false,
      error: `No order found for Shiprocket shipment ${shipmentId}`,
    };
  }
  if (!order.shiprocketOrderId) {
    return {
      success: false,
      error: "Order has no Shiprocket order id to cancel",
    };
  }

  try {
    const data = await retryAsync(
      () =>
        authenticatedRequest("/orders/cancel", {
          method: "POST",
          body: JSON.stringify({ ids: [Number(order.shiprocketOrderId)] }),
        }),
      { attempts: 2, delayMs: 1000, shouldRetry: isRetryableShiprocketError },
    );

    // authenticatedRequest() above already throws for any non-2xx response
    // (see its own definition) — that's the real success/failure signal for
    // this endpoint, a 2xx response here always means Shiprocket accepted
    // the cancellation. This used to also require the literal word
    // "success" to appear in data.message, which broke on Shiprocket's
    // actual wording for a real, successful cancellation — confirmed from a
    // real response body: {"message":"Your request to cancel order id
    // ORD-... has been taken. The freight amount against the order is
    // blocked and will be added back automatically to your wallet in 3-4
    // working days subject to confirmation from the courier.","status_code":...}
    // — no "success" anywhere in it, so that check misclassified a
    // confirmed cancellation as a failure and left the order un-cancelled.
    // Same class of bug as isAlreadyInPickupQueueError() above: Shiprocket's
    // message wording isn't a reliable success/failure signal on its own.

    await order.update({ pickupStatus: "cancelled" });
    console.log(
      `Shiprocket: order cancelled for order ${order.orderNumber} (shipment ${shipmentId}): ${data?.message || "no message in response"}`,
    );
    return { success: true, data };
  } catch (err) {
    console.error(
      `Shiprocket: pickup cancellation failed for order ${order.orderNumber}: ${err.message}`,
    );
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Label generation — triggered only by the admin's explicit "Generate
// Label" action (see generateLabelAndFulfill below), never automatically.
// ---------------------------------------------------------------------------

// Shiprocket's field name for the generated label PDF URL has varied across
// response versions — check the known variants rather than assuming one
// (same defensive approach as getEstimatedDeliveryDays/getPickupDateFromResponse).
function getLabelUrlFromResponse(data) {
  return (
    data?.label_url ||
    data?.response?.label_url ||
    data?.data?.label_url ||
    null
  );
}

// Generates a shipping label for an AWB-assigned shipment. Looked up by
// shiprocketShipmentId (same lookup as assignAWBWithRetry/schedulePickup,
// for consistency). Never throws — every failure path is recorded on the
// order and returned as { success: false, error }, matching
// createShiprocketOrder()'s contract.
async function generateLabel(shipmentId) {
  const order = await Order.findOne({
    where: { shiprocketShipmentId: String(shipmentId) },
  });
  if (!order) {
    return {
      success: false,
      error: `No order found for Shiprocket shipment ${shipmentId}`,
    };
  }

  try {
    const data = await retryAsync(
      () =>
        authenticatedRequest("/courier/generate/label", {
          method: "POST",
          body: JSON.stringify({ shipment_id: [Number(shipmentId)] }),
        }),
      { attempts: 2, delayMs: 1000, shouldRetry: isRetryableShiprocketError },
    );

    const labelUrl = getLabelUrlFromResponse(data);
    if (data?.label_created !== 1 || !labelUrl) {
      throw new Error(
        data?.response?.data ||
          data?.message ||
          "Shiprocket did not return a label",
      );
    }

    await order.update({
      labelUrl,
      labelStatus: "generated",
      labelGeneratedAt: new Date(),
      lastLabelError: null,
    });

    console.log(
      `Shiprocket: label generated for order ${order.orderNumber} (shipment ${shipmentId})`,
    );
    return { success: true, data: { labelUrl } };
  } catch (err) {
    console.error(
      `Shiprocket: label generation failed for order ${order.orderNumber}: ${err.message}`,
    );
    await order.update({ labelStatus: "failed", lastLabelError: err.message });
    return { success: false, error: err.message };
  }
}

// Orchestrator: the full order -> shipment -> AWB -> label -> pickup
// pipeline in one call. The sole trigger point for the Shiprocket pipeline
// — run only from the admin's explicit "Generate Label" action (see
// adminOrderController.generateLabel), never from any order-status
// transition. createShiprocketOrder/checkServiceability/assignAWBWithRetry
// are called as-is, unmodified.
//
// Each step is skipped (not re-run) if the order already has it recorded —
// createShiprocketOrder/assignAWB have no idempotency guard of their own,
// so re-running a completed step here would push Shiprocket again. This
// makes clicking "Generate Label" again after a partial failure safe: it
// resumes from whichever step actually failed instead of redoing
// everything. Pickup scheduling is the exception — always re-attempted,
// since re-requesting a pickup is safe. Never throws — same { success,
// error } contract as every step it calls, with every step's outcome
// already recorded on the order row itself.
async function generateLabelAndFulfill(orderId) {
  const existingOrder = await Order.findByPk(orderId, {
    include: [{ model: OrderItem }],
  });
  if (!existingOrder) {
    return { success: false, error: "Order not found" };
  }

  if (existingOrder.shipmentStatus !== "created") {
    const shipmentResult = await createShiprocketOrder(orderId);
    if (!shipmentResult.success) {
      return shipmentResult;
    }
  }

  const order = await Order.findByPk(orderId, {
    include: [{ model: OrderItem }],
  });

  if (order.awbStatus !== "assigned") {
    let courierList;
    try {
      const totalWeightKg = Math.max(
        order.OrderItems.reduce(
          (sum, item) => sum + parseWeightToKg(item.weight) * item.quantity,
          0,
        ),
        MIN_SHIPMENT_WEIGHT_KG,
      );
      const codAmount = order.paymentMethod === "cod" ? Number(order.total) : 0;

      courierList = await checkServiceability(
        order.shiprocketShipmentId,
        order.shippingPincode,
        totalWeightKg,
        codAmount,
      );
      selectCheapestCourier(courierList); // throws if empty, before bothering assignAWBWithRetry
    } catch (err) {
      console.error(
        `Shiprocket: serviceability check failed for order ${order.orderNumber}: ${err.message}`,
      );
      await order.update({ awbStatus: "failed", lastAwbError: err.message });
      return { success: false, error: err.message };
    }

    const awbResult = await assignAWBWithRetry(
      order.shiprocketShipmentId,
      courierList,
    );
    if (!awbResult.success) {
      return awbResult;
    }
  }

  if (order.labelStatus !== "generated") {
    const labelResult = await generateLabel(order.shiprocketShipmentId);
    if (!labelResult.success) {
      return labelResult;
    }

    await order.update({
      customerStatus: "dispatched",
      statusHistory: { ...order.statusHistory, dispatched: new Date() },
    });
    notifyOrderDispatched(order.id).catch((err) =>
      console.error(
        `Notification: order-dispatched send threw unexpectedly for order ${order.orderNumber}: ${err.message}`,
      ),
    );
  }

  return schedulePickup(order.shiprocketShipmentId);
}

// ---------------------------------------------------------------------------
// Phase 7 — inbound status webhooks (POST /api/webhooks/courier-updates, see
// controllers/webhookController.js shiprocketWebhook).
// ---------------------------------------------------------------------------

// Same DB-first pattern as getCredentials()/getPickupLocation() above, but
// no .env fallback — this is a brand-new secret with nothing to migrate
// from, so an unconfigured webhook should fail closed (reject every
// request) rather than silently accept anything.
async function getWebhookSecret() {
  const setting = await IntegrationSetting.findOne({ where: { integrationKey: INTEGRATION_KEY } });
  const secret = setting?.config?.webhookSecret;
  if (!secret) {
    throw new Error(
      "Shiprocket webhook secret is not configured — set it up from the admin panel (Settings > Integrations > Shiprocket)",
    );
  }
  return decrypt(secret);
}

// Shiprocket's published status-term glossary (support.shiprocket.in —
// "Important Terms All Shiprocket Users Should Know"), matched
// case-insensitively since their casing isn't guaranteed stable across
// payloads. Every RTO sub-status (RTO Initiated, RTO-OFD, RTO Delivered,
// RTO Acknowledged, RTO Rejected, RTO-NDR) and "Disposed Of" all fold into
// a single "rto" value — the app doesn't need to distinguish which RTO
// stage a shipment is in, just that it's being returned. Statuses with no
// entry here (Pickup Exception, Undelivered/NDR, Delayed, Misrouted,
// weight-discrepancy statuses, return-order statuses, ...) are logged and
// left alone rather than guessed at — see handleShiprocketStatusWebhook.
const STATUS_MAP = [
  { pattern: /^picked[\s-]?up$/i, customerStatus: "picked_up" },
  { pattern: /^(shipped|in[\s-]?transit|reached[\s-]?at[\s-]?destination[\s-]?hub)$/i, customerStatus: "in_transit" },
  { pattern: /^out[\s-]?for[\s-]?delivery$/i, customerStatus: "out_for_delivery" },
  { pattern: /^delivered$/i, customerStatus: "delivered" },
  { pattern: /^(rto|disposed[\s-]?of)/i, customerStatus: "rto" },
];

function mapShiprocketStatus(currentStatus) {
  const normalized = String(currentStatus || "").trim();
  const match = STATUS_MAP.find((entry) => entry.pattern.test(normalized));
  return match?.customerStatus || null;
}

// The linear "happy path" — used to guard against a late/duplicate webhook
// moving customerStatus *backward* (Shiprocket can retry a delivery, and
// events aren't guaranteed to arrive in order). "rto" is deliberately not
// in this list: it's a separate terminal branch that can follow any of
// these (a shipment can be returned after already being "out for
// delivery"), not a step along the happy path, and nothing moves a
// shipment forward again once it's "rto".
const STATUS_PROGRESSION = ["confirmed", "dispatched", "picked_up", "in_transit", "out_for_delivery", "delivered"];

function isForwardProgress(currentCustomerStatus, nextCustomerStatus) {
  // Cancellation is terminal from every direction — once a webhook/simulator
  // sees a cancelled order, nothing (a late courier-status event included)
  // is allowed to move it anywhere else. Checked before the "rto" branch
  // below since it applies regardless of what nextCustomerStatus is.
  if (currentCustomerStatus === "cancelled") return false;
  if (nextCustomerStatus === "rto") return currentCustomerStatus !== "rto";
  if (currentCustomerStatus === "rto") return false;
  const currentIndex = STATUS_PROGRESSION.indexOf(currentCustomerStatus);
  const nextIndex = STATUS_PROGRESSION.indexOf(nextCustomerStatus);
  if (currentIndex === -1 || nextIndex === -1) return true; // unrecognized current value — don't block
  return nextIndex > currentIndex;
}

// Core status-update logic, addressed directly by orderId rather than a
// shipment/order-id lookup — shared by the real webhook (handleShiprocket-
// StatusWebhook below, which resolves an order from the payload first) AND
// the admin test simulator (controllers/adminOrderController.js
// simulateStatusUpdate, which already has an orderId from the URL). Both
// go through the exact same mapping + forward-only guard + email trigger,
// so the simulator exercises the real code path rather than a
// reimplementation of it. Maps the raw status, applies it to the order, and
// fires whichever Step B email that transition corresponds to. Idempotent —
// a duplicate/retried event (same status, or one already superseded) is a
// no-op, same "already applied is still success" contract as
// utils/convertAbandonedCheckout.js. Never throws — same { success, error }
// contract as every step above.
async function processStatusUpdate(orderId, rawStatus) {
  const order = await Order.findByPk(orderId);
  if (!order) {
    const error = `No order found with id ${orderId}`;
    console.error(`Shiprocket status update: ${error}`);
    return { success: false, error, orderId: null };
  }

  const nextStatus = mapShiprocketStatus(rawStatus);
  if (!nextStatus) {
    console.log(
      `Shiprocket status update: unrecognized/non-actionable status "${rawStatus}" for order ${order.orderNumber} — logged, no customerStatus change`,
    );
    return { success: true, orderId: order.id, skipped: true, reason: "unrecognized or non-actionable status" };
  }

  if (!isForwardProgress(order.customerStatus, nextStatus)) {
    console.log(
      `Shiprocket status update: order ${order.orderNumber} already at or past "${nextStatus}" (currently "${order.customerStatus}") — ignoring stale/duplicate event`,
    );
    return { success: true, orderId: order.id, skipped: true, reason: "already applied" };
  }

  await order.update({
    customerStatus: nextStatus,
    statusHistory: { ...order.statusHistory, [nextStatus]: new Date() },
  });
  console.log(`Shiprocket status update: order ${order.orderNumber} customerStatus -> ${nextStatus} (raw status: "${rawStatus}")`);

  // "picked_up" also fires the "Order Packed" email — the real pickup-scan
  // event Step B originally wanted, running alongside (not replacing) the
  // label-generation-time fallback in generateLabelAndFulfill above, since
  // both are guarded by the same emailsSent.packed flag: whichever fires
  // first wins, and webhook delivery isn't guaranteed (not yet configured,
  // or a delivery hiccup on Shiprocket's side), so the fallback stays as a
  // safety net rather than being replaced outright.
  let emailTriggered = null;
  if (nextStatus === "picked_up") {
    emailTriggered = "order-packed";
    notifyOrderDispatched(order.id).catch((err) =>
      console.error(`Notification: order-dispatched send threw unexpectedly for order ${order.orderNumber}: ${err.message}`),
    );
  } else if (nextStatus === "out_for_delivery") {
    emailTriggered = "out-for-delivery";
    // No WhatsApp template for this event (see utils/notifications.js) —
    // always email, regardless of the order's notificationChannel.
    sendOrderOutForDeliveryEmail(order.id).catch((err) =>
      console.error(`Email: out-for-delivery send threw unexpectedly for order ${order.orderNumber}: ${err.message}`),
    );
  } else if (nextStatus === "delivered") {
    emailTriggered = "delivered";
    notifyOrderDelivered(order.id).catch((err) =>
      console.error(`Notification: order-delivered send threw unexpectedly for order ${order.orderNumber}: ${err.message}`),
    );
  }

  return { success: true, orderId: order.id, customerStatus: nextStatus, emailTriggered };
}

// Resolves which order a real Shiprocket webhook payload is about, then
// delegates to processStatusUpdate above. Called from
// controllers/webhookController.js, which verifies the webhook secret and
// persists the raw payload (ShiprocketWebhookLog) before this runs.
//
// IMPORTANT — confirmed against real production payloads on 2026-08-27
// (not just Shiprocket's docs, which don't spell this out): the courier
// status webhook does NOT reuse the `order_id`/`shipment_id` field names
// from the order-creation response (`/orders/create/adhoc`, see
// createShiprocketOrder above) the way this function originally assumed.
// A real webhook body instead looks like:
//   { awb: "1319460818628", sr_order_id: 1540758693,
//     order_id: "ORD-1787673804350", current_status: "PICKED UP", ... }
// i.e. `shipment_id` isn't present at all, `sr_order_id` is Shiprocket's
// own order id (what we store as Order.shiprocketOrderId), and `order_id`
// here is actually OUR channel order number echoed back — matches
// Order.orderNumber, not Order.shiprocketOrderId. Getting this wrong meant
// every real webhook silently failed to match any order (logged with
// orderId: null) while the admin-simulation tool — which calls
// processStatusUpdate directly with an orderId already in hand — kept
// working, masking the bug. `awb` is checked first since it's the most
// direct/unique identifier for one shipment; the other two are fallbacks
// in case a payload variant ever omits it.
async function handleShiprocketStatusWebhook(payload) {
  const awbCode = payload?.awb ?? payload?.awb_code;
  const srOrderId = payload?.sr_order_id;
  const ourOrderNumber = payload?.order_id;
  const rawStatus = payload?.current_status ?? payload?.shipment_status;

  const order =
    (awbCode && (await Order.findOne({ where: { awbCode: String(awbCode) } }))) ||
    (srOrderId && (await Order.findOne({ where: { shiprocketOrderId: String(srOrderId) } }))) ||
    (ourOrderNumber && (await Order.findOne({ where: { orderNumber: String(ourOrderNumber) } }))) ||
    null;

  if (!order) {
    const error = `No order found for Shiprocket webhook (awb=${awbCode}, sr_order_id=${srOrderId}, order_id=${ourOrderNumber})`;
    console.error(`Shiprocket webhook: ${error}`);
    return { success: false, error, orderId: null };
  }

  return processStatusUpdate(order.id, rawStatus);
}

module.exports = {
  login,
  getToken,
  authenticatedRequest,
  invalidateToken,
  getWalletBalance,
  createShiprocketOrder,
  checkServiceability,
  checkPincodeServiceability,
  selectCheapestCourier,
  assignAWBWithRetry,
  schedulePickup,
  cancelPickup,
  generateLabel,
  generateLabelAndFulfill,
  parseWeightToKg,
  getWebhookSecret,
  mapShiprocketStatus,
  processStatusUpdate,
  handleShiprocketStatusWebhook,
};
