require("dotenv").config();
const { sequelize, Category, Product, ProductVariant } = require("../models");

// Tags must only ever come from this fixed badge set.
const TAGS = {
  natural: "100% Natural",
  nutrition: "Rich in Nutrition",
  premium: "Premium Quality",
  healthy: "Healthy Lifestyle",
};

// Standard three weight-variant pricing helper (250g / 500g / 1kg), with
// per-category price points passed in as [price250, price500, price1kg] and
// an mrp markup applied on top.
function variants(price250, price500, price1kg) {
  const mrpFactor = 1.18;
  return [
    { weight: "250g", price: price250, mrp: Math.round(price250 * mrpFactor), stock: 60, sortOrder: 0 },
    { weight: "500g", price: price500, mrp: Math.round(price500 * mrpFactor), stock: 40, sortOrder: 1 },
    { weight: "1kg", price: price1kg, mrp: Math.round(price1kg * mrpFactor), stock: 20, sortOrder: 2 },
  ];
}

const CATALOG = [
  {
    category: "Almonds",
    products: [
      {
        name: "Premium California Almonds",
        shortDescription: "Handpicked, crunchy California almonds — a daily dose of good health.",
        longDescription:
          "Our Premium California Almonds are sourced directly from trusted orchards and undergo minimal processing to retain their natural crunch and nutrition. Rich in Vitamin E, protein, and healthy fats, they make the perfect guilt-free snack or addition to your morning routine.",
        tags: [TAGS.natural, TAGS.nutrition],
        variants: variants(299, 549, 999),
      },
      {
        name: "Roasted & Salted Almonds",
        shortDescription: "Lightly roasted almonds with a hint of Himalayan pink salt.",
        longDescription:
          "Slow-roasted to perfection and seasoned with a touch of Himalayan pink salt, these almonds deliver bold flavor without compromising on nutrition. A wholesome snack for tea-time cravings or on-the-go munching.",
        tags: [TAGS.premium, TAGS.healthy],
        variants: variants(319, 579, 1049),
      },
    ],
  },
  {
    category: "Cashews",
    products: [
      {
        name: "Whole W240 Cashews",
        shortDescription: "Premium grade W240 whole cashews — creamy, buttery, and fresh.",
        longDescription:
          "Graded W240 (240 nuts per pound), these whole cashews are prized for their large size and rich, buttery taste. Carefully processed and packed to lock in freshness, they're perfect for snacking, gifting, or your favorite kitchen recipes.",
        tags: [TAGS.premium, TAGS.natural],
        variants: variants(349, 649, 1199),
      },
      {
        name: "Roasted Cashew Nuts",
        shortDescription: "Golden roasted cashews with a light, satisfying crunch.",
        longDescription:
          "Our cashews are dry-roasted in small batches to bring out a deep, nutty aroma while keeping added oil to a minimum. A rich source of magnesium and healthy fats, ideal for a wholesome evening snack.",
        tags: [TAGS.nutrition, TAGS.healthy],
        variants: variants(329, 619, 1129),
      },
    ],
  },
  {
    category: "Walnuts",
    products: [
      {
        name: "Kashmiri Walnut Kernels",
        shortDescription: "Light-colored, extra-large walnut halves from the Kashmir valley.",
        longDescription:
          "Sourced from the orchards of Kashmir, these walnut kernels are known for their light color, buttery flavor, and minimal bitterness. Packed with Omega-3 fatty acids, they're excellent for heart and brain health.",
        tags: [TAGS.natural, TAGS.nutrition],
        variants: variants(399, 749, 1399),
      },
      {
        name: "Walnut Halves & Pieces",
        shortDescription: "A convenient mix of walnut halves and pieces for baking and snacking.",
        longDescription:
          "A versatile blend of walnut halves and pieces, perfect for baking, salads, or straight-up snacking. Every batch is quality-checked for freshness and crunch.",
        tags: [TAGS.healthy, TAGS.premium],
        variants: variants(369, 699, 1299),
      },
    ],
  },
  {
    category: "Pistachios",
    products: [
      {
        name: "Iranian Roasted Pistachios",
        shortDescription: "Naturally split, roasted and lightly salted Iranian pistachios.",
        longDescription:
          "These naturally split Iranian pistachios are roasted in-shell to preserve their signature aroma and lightly salted for a classic snacking experience. A great source of protein, fiber, and antioxidants.",
        tags: [TAGS.premium, TAGS.nutrition],
        variants: variants(449, 849, 1599),
      },
      {
        name: "Pistachio Kernels (Unsalted)",
        shortDescription: "Shelled, unsalted pistachio kernels — ready to eat or cook with.",
        longDescription:
          "Perfectly shelled pistachio kernels with no added salt or oil, ideal for those watching their sodium intake or looking to add a nutty crunch to desserts and savory dishes alike.",
        tags: [TAGS.natural, TAGS.healthy],
        variants: variants(479, 899, 1699),
      },
    ],
  },
  {
    category: "Raisins",
    products: [
      {
        name: "Golden Seedless Raisins",
        shortDescription: "Sun-dried, seedless golden raisins with natural sweetness.",
        longDescription:
          "Our golden seedless raisins are sun-dried to lock in natural sweetness and softness. A rich source of iron and natural energy, perfect for snacking, baking, or garnishing desserts.",
        tags: [TAGS.natural, TAGS.healthy],
        variants: variants(149, 279, 499),
      },
      {
        name: "Black Kishmish (Raisins)",
        shortDescription: "Long, dark and naturally sweet black raisins.",
        longDescription:
          "Black Kishmish raisins are known for their deep flavor and chewy texture. Rich in antioxidants and dietary fiber, they're a popular addition to Indian sweets, trail mixes, and everyday snacking.",
        tags: [TAGS.nutrition, TAGS.premium],
        variants: variants(169, 309, 559),
      },
    ],
  },
  {
    category: "Sunflower Seeds",
    products: [
      {
        name: "Roasted Sunflower Seeds",
        shortDescription: "Crunchy, lightly salted roasted sunflower seeds.",
        longDescription:
          "A crunchy, protein-packed snack, our roasted sunflower seeds are lightly salted to bring out their natural nutty flavor. Great as a topping for salads, smoothie bowls, or on their own.",
        tags: [TAGS.healthy, TAGS.natural],
        variants: variants(129, 229, 399),
      },
      {
        name: "Raw Sunflower Seeds",
        shortDescription: "Unsalted, unroasted sunflower seeds for everyday nutrition.",
        longDescription:
          "These raw sunflower seeds retain all their natural goodness — rich in Vitamin E, healthy fats, and minerals. Perfect for baking, sprinkling over meals, or a wholesome homemade trail mix.",
        tags: [TAGS.nutrition, TAGS.healthy],
        variants: variants(119, 209, 369),
      },
    ],
  },
  {
    category: "Pumpkin Seeds",
    products: [
      {
        name: "Roasted Pumpkin Seeds (Pepitas)",
        shortDescription: "Lightly roasted, protein-rich pumpkin seed kernels.",
        longDescription:
          "Our pepitas are lightly roasted to enhance their earthy flavor while preserving their impressive nutrient profile — high in magnesium, zinc, and plant-based protein. A smart snack for active lifestyles.",
        tags: [TAGS.nutrition, TAGS.premium],
        variants: variants(199, 369, 679),
      },
      {
        name: "Raw Pumpkin Seed Kernels",
        shortDescription: "Naturally shelled, raw pumpkin seed kernels.",
        longDescription:
          "Shelled and unroasted, these pumpkin seed kernels are as close to nature as it gets. Add them to your salads, smoothies, or granola for an extra boost of nutrition.",
        tags: [TAGS.natural, TAGS.healthy],
        variants: variants(189, 349, 639),
      },
    ],
  },
  {
    category: "Mix Dry Fruits",
    products: [
      {
        name: "Premium Dry Fruits Combo",
        shortDescription: "A curated mix of almonds, cashews, walnuts, and raisins.",
        longDescription:
          "Our Premium Dry Fruits Combo brings together the best of almonds, cashews, walnuts, and raisins in one wholesome pack — perfect for gifting or everyday indulgence, packed with essential vitamins and minerals.",
        tags: [TAGS.premium, TAGS.nutrition],
        variants: variants(379, 699, 1299),
      },
      {
        name: "Everyday Dry Fruits Mix",
        shortDescription: "An everyday blend of nuts for a quick, healthy snack.",
        longDescription:
          "A budget-friendly, everyday mix combining assorted nuts and dried fruits, thoughtfully put together for a quick and nourishing snack anytime, anywhere.",
        tags: [TAGS.healthy, TAGS.natural],
        variants: variants(299, 559, 999),
      },
    ],
  },
  {
    category: "Seeds Mix",
    products: [
      {
        name: "Super Seeds Mix",
        shortDescription: "A power-packed mix of sunflower, pumpkin, flax and chia seeds.",
        longDescription:
          "Our Super Seeds Mix combines sunflower, pumpkin, flax, and chia seeds into one nutrient-dense blend — ideal for sprinkling over salads, yogurt bowls, or smoothies to boost your daily fiber and Omega-3 intake.",
        tags: [TAGS.nutrition, TAGS.healthy],
        variants: variants(229, 419, 749),
      },
      {
        name: "Roasted Seeds Trail Mix",
        shortDescription: "A crunchy, lightly roasted seeds trail mix.",
        longDescription:
          "A savory, lightly roasted blend of mixed seeds designed for on-the-go snacking without compromising on nutrition or taste.",
        tags: [TAGS.natural, TAGS.premium],
        variants: variants(209, 389, 699),
      },
    ],
  },
  {
    category: "Cutting Dry Fruits Mix",
    products: [
      {
        name: "Cutting Mix (Chopped Dry Fruits)",
        shortDescription: "Finely chopped mixed dry fruits, ready to use in desserts and cooking.",
        longDescription:
          "Our Cutting Mix is a finely chopped blend of almonds, cashews, and pistachios — perfectly sized for garnishing kheer, halwa, cakes, and other desserts without any extra prep work.",
        tags: [TAGS.premium, TAGS.natural],
        variants: variants(349, 649, 1199),
      },
      {
        name: "Chopped Nuts for Desserts",
        shortDescription: "A fine chop of assorted nuts, ideal for baking and garnishing.",
        longDescription:
          "Pre-chopped and ready to sprinkle, this assorted nut mix saves you prep time while adding a delightful crunch and nutty flavor to your favorite desserts and dishes.",
        tags: [TAGS.healthy, TAGS.nutrition],
        variants: variants(329, 609, 1099),
      },
    ],
  },
];

async function seedCatalog() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();

    for (const entry of CATALOG) {
      const [category] = await Category.findOrCreate({
        where: { name: entry.category },
        defaults: { name: entry.category, status: true },
      });

      for (const productData of entry.products) {
        const existing = await Product.findOne({
          where: { name: productData.name, categoryId: category.id },
        });
        if (existing) {
          console.log(`Skipping existing product: ${productData.name}`);
          continue;
        }

        const product = await Product.create({
          name: productData.name,
          categoryId: category.id,
          shortDescription: productData.shortDescription,
          longDescription: productData.longDescription,
          tags: productData.tags,
          status: true,
          showOnHome: Math.random() < 0.4,
        });

        for (const variant of productData.variants) {
          await ProductVariant.create({ ...variant, productId: product.id });
        }

        console.log(`Created product: ${productData.name} (${entry.category})`);
      }
    }

    console.log("Catalog seed complete.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to seed catalog:", err);
    process.exit(1);
  }
}

seedCatalog();
