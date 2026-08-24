const { ProductVariant, ComboOffer, ComboOfferItem } = require("../models");

/**
 * Groups the already-priced line items by comboOfferId and checks each
 * group's submitted variant/quantity set against the combo's real
 * definition (ComboOfferItem rows) — this is the server-side re-check that
 * stops a tampered/stale client payload from billing a combo's cheap item
 * 10x and its expensive item 0x. A valid group must submit exactly the
 * combo's product set, each at some consistent whole-number multiple
 * (`instanceCount`) of its defined per-combo quantity.
 *
 * Returns { comboDiscount } — the total amount to subtract from subtotal so
 * every valid combo group is billed at `comboPrice * instanceCount` instead
 * of the sum of its real per-item prices — or { error } if any group is
 * invalid/stale. Line items themselves (and their `price`/`weight`) are
 * left untouched: stock decrement, weight summation, and COD checks all
 * keep working off real productId/variantId/quantity, unaware combos exist.
 */
async function calculateComboDiscount(lineItems) {
  const groups = new Map();
  for (const item of lineItems) {
    if (!item.comboOfferId) continue;
    if (!groups.has(item.comboOfferId)) groups.set(item.comboOfferId, []);
    groups.get(item.comboOfferId).push(item);
  }
  if (groups.size === 0) return { comboDiscount: 0 };

  let comboDiscount = 0;
  for (const [comboOfferId, groupLines] of groups) {
    const combo = await ComboOffer.findByPk(comboOfferId, {
      include: [{ model: ComboOfferItem, as: "items" }],
    });
    if (!combo || !combo.status) {
      return { error: "One of the selected combos is no longer available" };
    }

    const submittedByVariant = new Map();
    for (const line of groupLines) {
      submittedByVariant.set(line.variantId, (submittedByVariant.get(line.variantId) || 0) + line.quantity);
    }

    const comboItemByVariant = new Map(combo.items.map((ci) => [ci.variantId, ci.quantity]));

    if (submittedByVariant.size !== comboItemByVariant.size) {
      return { error: `"${combo.title}" selection doesn't match the combo's product list` };
    }

    let instanceCount = null;
    for (const [variantId, submittedQty] of submittedByVariant) {
      const requiredQty = comboItemByVariant.get(variantId);
      if (!requiredQty || submittedQty % requiredQty !== 0) {
        return { error: `"${combo.title}" selection doesn't match the combo's product list` };
      }
      const candidate = submittedQty / requiredQty;
      if (instanceCount === null) instanceCount = candidate;
      else if (instanceCount !== candidate) {
        return { error: `"${combo.title}" selection doesn't match the combo's product list` };
      }
    }

    const individualTotal = groupLines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const discount = Math.max(0, individualTotal - Number(combo.comboPrice) * instanceCount);
    comboDiscount += discount;
  }

  return { comboDiscount: Number(comboDiscount.toFixed(2)) };
}

/**
 * Given an array of { variantId, quantity, comboOfferId? }, look up each
 * ProductVariant's price (not the Product's — pricing lives on the variant
 * in Sehat Potli's weight-based schema) and compute the subtotal. A
 * `comboOfferId` on an entry just tags which combo that real product line
 * came from — it's still priced/stocked/shipped as a real product line;
 * see calculateComboDiscount above for how the combo's price override is
 * applied on top, via `comboDiscount` rather than by changing `price` here.
 *
 * Returns { error: string } if any variantId is invalid or a combo
 * selection doesn't check out, otherwise
 * { subtotal, items: [{ variantId, productId, weight, price, quantity, comboOfferId }], comboDiscount }.
 */
async function calculateSubtotal(cartItems) {
  let subtotal = 0;
  const items = [];

  for (const entry of cartItems) {
    const variant = await ProductVariant.findByPk(entry.variantId);
    if (!variant) {
      return { error: `Invalid product variant: ${entry.variantId}` };
    }
    const quantity = Number(entry.quantity) || 1;
    const price = Number(variant.price);
    subtotal += price * quantity;
    items.push({
      variantId: variant.id,
      productId: variant.productId,
      weight: variant.weight,
      price,
      quantity,
      comboOfferId: entry.comboOfferId || null,
    });
  }

  const comboResult = await calculateComboDiscount(items);
  if (comboResult.error) return { error: comboResult.error };

  return {
    subtotal: Number(subtotal.toFixed(2)),
    items,
    comboDiscount: comboResult.comboDiscount,
  };
}

module.exports = calculateSubtotal;
