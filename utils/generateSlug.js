const { Op } = require("sequelize");

// Lowercase, hyphenated, special-characters-stripped, multiple-hyphens-
// collapsed. Pure string transform — no DB access, no uniqueness handling
// (see generateUniqueProductSlug below for that layer). Used both for the
// real slug (backend, on save) and could be reused for a live frontend
// preview if ever needed, though the admin form keeps its own tiny copy for
// that (see sehat-potli-admin ProductForm.jsx) since the real, authoritative
// value only ever comes from here.
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // strip anything that isn't a letter, digit, space, or hyphen
    .replace(/[\s-]+/g, "-") // collapse runs of whitespace/hyphens into one hyphen
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
}

// Slugifies `baseText` and appends "-2", "-3", ... until the result doesn't
// collide with another product's slug. `excludeId` is the product's own id
// on an update — without it, a product saved twice in a row (unchanged
// name) would collide with itself and get bumped to "-2" every single save.
// Falls back to the literal "product" (then "product-2", "-3", ... via the
// same uniqueness loop) if slugify() produces an empty string — e.g. a name
// made entirely of emoji/symbols — never saves an empty slug.
async function generateUniqueProductSlug({ Product, baseText, excludeId }) {
  const base = slugify(baseText) || "product";
  let candidate = base;
  let suffix = 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where = { slug: candidate };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    // eslint-disable-next-line no-await-in-loop
    const collision = await Product.findOne({ where, attributes: ["id"] });
    if (!collision) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

module.exports = { slugify, generateUniqueProductSlug };
