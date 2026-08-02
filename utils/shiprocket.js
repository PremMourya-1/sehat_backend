const {
  IntegrationSetting,
  Order,
  OrderItem,
  Product,
  Customer,
} = require("../models");
const { encrypt, decrypt } = require("./encryption");
const { retryAsync } = require("./retry");

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
    throw new Error(`Shiprocket request failed (${res.status})`);
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

// Only the two checks Phase 2 asks for. This store has no payment gateway
// yet, so there's no separate "confirmed" order status — marking an order
// "processing" (see adminOrderController.updateOrderStatus) is the existing
// status transition that plays that role for COD orders today.
function validateOrderForShipment(order) {
  if (order.paymentMethod === "prepaid" && order.paymentStatus !== "paid") {
    return {
      valid: false,
      reason: "Prepaid order has no successful payment record",
    };
  }
  if (order.paymentMethod === "cod" && order.status !== "processing") {
    return {
      valid: false,
      reason: `COD order is not confirmed yet (status is "${order.status}")`,
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
  console.log("kr rha hu na ordr");
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
    (addr) => String(addr.pickup_location || "").trim().toLowerCase() === pickupLocation.trim().toLowerCase(),
  );

  if (!match?.pin_code) {
    throw new Error(`Could not find a pickup pincode for Shiprocket pickup location "${pickupLocation}"`);
  }
  return String(match.pin_code);
}

// Returns Shiprocket's available couriers for a delivery pincode/weight/COD
// combination, ready for selectFastestCourier(). shipmentId isn't part of
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

  const data = await authenticatedRequest(`/courier/serviceability/?${query.toString()}`, { method: "GET" });
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
  const couriers = await checkServiceability("pincode-check", deliveryPincode, weight, codAmount);
  return {
    serviceable: couriers.length > 0,
    codAvailable: couriers.some((courier) => Number(courier.cod) === 1),
  };
}

// Shiprocket's field name for estimated delivery time has varied across
// response versions — check the known variants rather than assuming one.
function getEstimatedDeliveryDays(courier) {
  const raw =
    courier?.estimated_delivery_days ?? courier?.etd_days ?? courier?.edd ?? courier?.estimated_delivery_time;
  const parsed = Number(String(raw ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : Infinity;
}

function sortCouriersByFastest(courierList) {
  return [...courierList].sort((a, b) => getEstimatedDeliveryDays(a) - getEstimatedDeliveryDays(b));
}

// Picks the courier with the shortest estimated delivery time from a
// checkServiceability() result.
function selectFastestCourier(courierList) {
  if (!Array.isArray(courierList) || courierList.length === 0) {
    throw new Error("No couriers available to select from");
  }
  return sortCouriersByFastest(courierList)[0];
}

// Single AWB assignment attempt against one courier. Throws on any failure
// (HTTP-level via authenticatedRequest, or a logical failure Shiprocket
// reports inside a 200 response) — assignAWBWithRetry is what catches this
// and moves on to the next courier.
async function assignAWB(shipmentId, courierId) {
  const data = await authenticatedRequest("/courier/assign/awb", {
    method: "POST",
    body: JSON.stringify({ shipment_id: shipmentId, courier_id: courierId }),
  });

  const awbData = data?.response?.data;
  if (data?.awb_assign_status !== 1 || !awbData?.awb_code) {
    const reason = (typeof awbData === "string" && awbData) || data?.message || "Shiprocket did not assign an AWB";
    throw new Error(reason);
  }

  return {
    awbCode: String(awbData.awb_code),
    courierCompanyId: String(awbData.courier_company_id ?? courierId),
    courierName: awbData.courier_name || "",
  };
}

const MAX_AWB_ATTEMPTS = 3;

// Tries the fastest courier first, and on failure falls through to the
// next-fastest — a different courier each attempt, not the same one retried
// — stopping once one succeeds, the courier list is exhausted, or
// MAX_AWB_ATTEMPTS is hit. Never throws: every outcome (success or every
// courier failing) is recorded on the order and returned as
// { success, error }, matching createShiprocketOrder()'s contract.
async function assignAWBWithRetry(shipmentId, courierList) {
  const order = await Order.findOne({ where: { shiprocketShipmentId: String(shipmentId) } });
  if (!order) {
    return { success: false, error: `No order found for Shiprocket shipment ${shipmentId}` };
  }

  if (!Array.isArray(courierList) || courierList.length === 0) {
    const error = "No couriers available to assign AWB";
    await order.update({ awbStatus: "failed", lastAwbError: error });
    return { success: false, error };
  }

  const couriers = sortCouriersByFastest(courierList);
  const maxAttempts = Math.min(couriers.length, MAX_AWB_ATTEMPTS);
  const attemptedCouriers = [];
  let courierIndex = 0;
  let lastError;

  try {
    const awbResult = await retryAsync(
      async () => {
        const courier = couriers[courierIndex];
        courierIndex += 1;
        attemptedCouriers.push(courier.courier_name || courier.courier_company_id);
        try {
          return await assignAWB(shipmentId, courier.courier_company_id);
        } catch (err) {
          lastError = err;
          throw err;
        }
      },
      { attempts: maxAttempts, delayMs: 500, shouldRetry: () => courierIndex < couriers.length },
    );

    await order.update({
      awbCode: awbResult.awbCode,
      courierCompanyId: awbResult.courierCompanyId,
      courierName: awbResult.courierName,
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
    console.error(`Shiprocket: AWB assignment failed for order ${order.orderNumber}: ${error}`);
    await order.update({ awbStatus: "failed", lastAwbError: error });
    return { success: false, error };
  }
}

// Orchestrator: the full order -> shipment -> AWB pipeline in one call.
// Runs createShiprocketOrder() first; only continues into serviceability +
// AWB assignment if that succeeded, since a failed/skipped shipment push
// has nothing to assign an AWB to yet. Never throws — same { success,
// error } contract as createShiprocketOrder()/assignAWBWithRetry(), with
// every step's outcome already recorded on the order row itself.
async function fulfillOrderShipment(orderId) {
  const shipmentResult = await createShiprocketOrder(orderId);
  if (!shipmentResult.success) {
    return shipmentResult;
  }

  const order = await Order.findByPk(orderId, { include: [{ model: OrderItem }] });

  let courierList;
  try {
    const totalWeightKg = Math.max(
      order.OrderItems.reduce((sum, item) => sum + parseWeightToKg(item.weight) * item.quantity, 0),
      MIN_SHIPMENT_WEIGHT_KG,
    );
    const codAmount = order.paymentMethod === "cod" ? Number(order.total) : 0;

    courierList = await checkServiceability(order.shiprocketShipmentId, order.shippingPincode, totalWeightKg, codAmount);
    selectFastestCourier(courierList); // throws if empty, before bothering assignAWBWithRetry
  } catch (err) {
    console.error(`Shiprocket: serviceability check failed for order ${order.orderNumber}: ${err.message}`);
    await order.update({ awbStatus: "failed", lastAwbError: err.message });
    return { success: false, error: err.message };
  }

  return assignAWBWithRetry(order.shiprocketShipmentId, courierList);
}

module.exports = {
  login,
  getToken,
  authenticatedRequest,
  invalidateToken,
  createShiprocketOrder,
  checkServiceability,
  checkPincodeServiceability,
  selectFastestCourier,
  assignAWBWithRetry,
  fulfillOrderShipment,
  parseWeightToKg,
};
