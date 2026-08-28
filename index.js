const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const helmet = require("helmet");
require("dotenv").config();

// DB_MODE=live (see package.json's "dev:live" script) re-points just the DB
// connection at the production database, on top of the normal local .env —
// everything else (port, JWT secret, CORS origins, ...) still comes from
// .env, only DATABASE_URL is overridden.
if (process.env.DB_MODE === "live") {
  require("dotenv").config({ path: ".env.live", override: true });
}

const { sequelize, connectDB } = require("./config/db");
require("./models");
const { initSocket } = require("./utils/socket");
const { startAbandonedOrderCleanupJob } = require("./utils/abandonedOrderCleanup");

const authRoutes = require("./routes/authRoutes");
const authAdapterRoutes = require("./routes/authAdapterRoutes");
const mobileRoutes = require("./routes/mobileRoutes");
const accountSecurityRoutes = require("./routes/accountSecurityRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const checkoutRoutes = require("./routes/checkoutRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const adminRoutes = require("./routes/adminRoutes");
const heroBannerRoutes = require("./routes/heroBannerRoutes");
const couponRoutes = require("./routes/couponRoutes");
const testimonialRoutes = require("./routes/testimonialRoutes");
const cmsRoutes = require("./routes/cmsRoutes");
const comboOfferRoutes = require("./routes/comboOfferRoutes");
const homeRoutes = require("./routes/homeRoutes");
const mixRoutes = require("./routes/mixRoutes");
const cartRewardRoutes = require("./routes/cartRewardRoutes");
const blogRoutes = require("./routes/blogRoutes");
const faqRoutes = require("./routes/faqRoutes");
const webSettingsRoutes = require("./routes/webSettingsRoutes");
const newsletterRoutes = require("./routes/newsletterRoutes");
const expensesRoutes = require("./routes/expensesRoutes");
const salesRoutes = require("./routes/salesRoutes");
const errorHandler = require("./middleware/errorHandler");
const {
  CmsPage,
  ComboOffer,
  BlogPost,
  Faq,
  ShippingZone,
} = require("./models");

const app = express();

// Keep-alive ping for an external uptime monitor (Render's free tier sleeps
// the service after ~15 min idle) — registered before every other
// middleware so it never depends on CORS/helmet/body-parsing/etc, and never
// touches the DB. Hit every 5 minutes, forever — must stay instant.
app.get("/ping", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(morgan("dev"));
// `verify` stashes the exact raw bytes on req.rawBody alongside the usual
// parsed req.body — needed by the Razorpay webhook handler, which has to
// HMAC the *raw* payload (a re-serialized JSON.stringify(req.body) isn't
// guaranteed byte-identical to what Razorpay actually signed).
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  cors({
    origin: [
      process.env.STORE_FRONT_URL,
      process.env.STORE_FRONT_URL2,
      process.env.STORE_ADMIN_URL,
      process.env.STORE_ADMIN_URL_LOCALE,
      process.env.STORE_ADMIN_URL_LOCALE2,
    ],
    credentials: true,
  }),
);

app.get("/", (req, res) => {
  res.send("sehat-potli-backend is running");
});

app.use("/uploads", express.static("uploads"));

app.use("/api/auth", authRoutes);
app.use("/api/auth/adapter", authAdapterRoutes);
app.use("/api/customer/mobile", mobileRoutes);
app.use("/api/customer/security", accountSecurityRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/hero-banners", heroBannerRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/testimonials", testimonialRoutes);
app.use("/api/cms", cmsRoutes);
app.use("/api/combo-offers", comboOfferRoutes);
app.use("/api/home", homeRoutes);
app.use("/api/mix-ingredients", mixRoutes);
app.use("/api/cart-reward-tiers", cartRewardRoutes);
app.use("/api/blog-posts", blogRoutes);
app.use("/api/faqs", faqRoutes);
app.use("/api/web-settings", webSettingsRoutes);
app.use("/api/newsletter", newsletterRoutes);
// Fully separate auth system from /api/admin — see FINANCE.md. Sales
// shares the exact same login/middleware as Expenses (see
// routes/salesRoutes.js) — one Finance mini-app, two resources.
app.use("/api/expenses", expensesRoutes);
app.use("/api/sales", salesRoutes);

app.use((req, res) => {
  res.status(404).json({ action: false, message: "Route not found" });
});

app.use(errorHandler);

const DEFAULT_CMS_PAGES = [
  {
    slug: "terms-and-conditions",
    title: "Terms & Conditions",
    content:
      "<p>Add your terms and conditions content from the admin panel.</p>",
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    content: "<p>Add your privacy policy content from the admin panel.</p>",
  },
  {
    slug: "refund-policy",
    title: "Refund Policy",
    content: "<p>Add your refund policy content from the admin panel.</p>",
  },
];

const seedCmsPages = async () => {
  for (const page of DEFAULT_CMS_PAGES) {
    await CmsPage.findOrCreate({ where: { slug: page.slug }, defaults: page });
  }
};

// One-time starter content for the new admin-managed list sections — only
// runs if the table is empty, so admin add/delete afterward is never undone.
const seedIfEmpty = async (Model, rows) => {
  if ((await Model.count()) > 0) return;
  for (let i = 0; i < rows.length; i++) {
    await Model.create({ ...rows[i], sortOrder: i });
  }
};

const seedStarterContent = async () => {
  await seedIfEmpty(ComboOffer, [
    {
      title: "Buy 2 Get 10% Off",
      description: "Mix and match any two 250g+ single dry fruit packs.",
      discountLabel: "10% OFF",
      ctaLabel: "Shop Combos",
      ctaLink: "/products",
    },
    {
      title: "Buy 3 Combo Packs @ Flat ₹1999",
      description: "Pick any three combo/assorted boxes at one flat price.",
      discountLabel: "FLAT ₹1999",
      ctaLabel: "Build This Deal",
      ctaLink: "/products",
    },
    {
      title: "Festive Bundle — Save 15%",
      description:
        "Trail Mix + Seeds Mix + Gift Hamper, bundled for the season.",
      discountLabel: "15% OFF",
      ctaLabel: "View Bundle",
      ctaLink: "/products",
    },
  ]);

  await seedIfEmpty(BlogPost, [
    {
      title: "5 Healthy Trail Mix Recipes for Busy Mornings",
      excerpt:
        "Quick, protein-packed combinations you can prep once and snack on all week.",
      readTime: "4 min read",
      content:
        "<p>Mornings are hectic, but that's no excuse to skip a nutritious snack. Here are five trail mix combinations you can batch-prep on a Sunday and portion out for the week ahead.</p><h3>1. Classic Energy Mix</h3><p>Almonds, cashews, raisins and a handful of dark chocolate chips — a balance of protein, healthy fats and a little sweetness.</p><h3>2. Protein Power Mix</h3><p>Roasted chana, peanuts and pumpkin seeds for a savory, protein-forward option.</p><h3>3. Antioxidant Mix</h3><p>Walnuts, dried cranberries and sunflower seeds — great for heart health.</p><h3>4. Kids' Favorite Mix</h3><p>Cashews, raisins and a few banana chips — mild and naturally sweet.</p><h3>5. Festive Mix</h3><p>Pistachios, almonds and dried figs — perfect for gifting or a special occasion.</p>",
    },
    {
      title: "Smart Snacking: How Much Dry Fruit Should You Eat Daily?",
      excerpt:
        "A simple guide to portion sizes for almonds, walnuts, and seed mixes.",
      readTime: "3 min read",
      content:
        "<p>Dry fruits are nutrient-dense, which means a little goes a long way. As a general guideline, a daily handful (about 25–30g) is enough to get the benefits without overdoing the calories.</p><h3>Almonds &amp; Cashews</h3><p>About 8–10 almonds or 6–8 cashews a day is a good baseline for most adults.</p><h3>Walnuts</h3><p>4–5 halves a day is plenty — they're higher in fat than most other nuts.</p><h3>Seeds</h3><p>1–2 tablespoons of chia, flax or pumpkin seeds daily works well sprinkled over meals.</p>",
    },
    {
      title: "The Festive Gifting Guide: Hampers That Feel Personal",
      excerpt:
        "How to pick (or build) a dry fruit hamper that doesn't feel generic.",
      readTime: "5 min read",
      content:
        "<p>A good gift hamper feels thoughtful, not generic. Here's how to pick one that stands out.</p><h3>Mix textures, not just types</h3><p>Combine something crunchy (almonds, pistachios), something chewy (dried figs, apricots) and something sweet (a small treat) for variety.</p><h3>Consider the packaging</h3><p>Reusable jars or tins add lasting value beyond the contents themselves.</p><h3>Personalize where you can</h3><p>A hand-written note or a custom mix based on the recipient's preferences makes all the difference.</p>",
    },
  ]);

  await seedIfEmpty(Faq, [
    {
      question: "How long does delivery take?",
      answer:
        "Most orders are delivered within 3–5 business days. Metro cities usually see delivery in 2–3 days.",
    },
    {
      question: "What is your return policy?",
      answer:
        "If a product arrives damaged or incorrect, you can request a return/replacement within 48 hours of delivery.",
    },
    {
      question: "How do you guarantee freshness?",
      answer:
        "Every batch is packed in small quantities and sealed in airtight, moisture-proof packaging with a printed best-before date.",
    },
    {
      question: "Is Cash on Delivery (COD) available?",
      answer:
        "Yes, COD is available on most pin codes. You'll see COD availability at checkout based on your delivery address.",
    },
    {
      question: "Can I subscribe for repeat orders?",
      answer:
        "Yes — use Subscribe & Save on any product to get it delivered automatically every 2 or 4 weeks, with an extra discount.",
    },
  ]);

  await seedShippingZones();
};

// Starting defaults only — fully editable by the admin afterward from
// Settings > Shipping Zones. Rajasthan is "same state" since that's where
// the pickup location is (see utils/shiprocket.js getPickupLocation).
const DEFAULT_SHIPPING_ZONES = [
  { zoneName: "Same State", states: ["Rajasthan"], shippingCharge: 40 },
  {
    zoneName: "Nearby States",
    states: [
      "Gujarat",
      "Madhya Pradesh",
      "Haryana",
      "Punjab",
      "Uttar Pradesh",
      "Delhi",
      "Chandigarh",
    ],
    shippingCharge: 60,
  },
  {
    zoneName: "Rest of India",
    states: [
      "Andhra Pradesh",
      "Bihar",
      "Chhattisgarh",
      "Goa",
      "Himachal Pradesh",
      "Jharkhand",
      "Karnataka",
      "Kerala",
      "Maharashtra",
      "Odisha",
      "Tamil Nadu",
      "Telangana",
      "Uttarakhand",
      "West Bengal",
      "Puducherry",
      "Dadra and Nagar Haveli and Daman and Diu",
    ],
    shippingCharge: 80,
  },
  {
    zoneName: "North-East & Remote",
    states: [
      "Arunachal Pradesh",
      "Assam",
      "Manipur",
      "Meghalaya",
      "Mizoram",
      "Nagaland",
      "Tripura",
      "Sikkim",
      "Jammu and Kashmir",
      "Ladakh",
      "Andaman and Nicobar Islands",
      "Lakshadweep",
    ],
    shippingCharge: 100,
  },
];

// Only runs if the table is empty, same as seedIfEmpty above — but kept
// separate since ShippingZone has no sortOrder column for that helper's
// sortOrder-per-row assumption to apply to.
const seedShippingZones = async () => {
  if ((await ShippingZone.count()) > 0) return;
  for (const zone of DEFAULT_SHIPPING_ZONES) {
    await ShippingZone.create(zone);
  }
};

const startServer = async () => {
  try {
    await connectDB();

    // DB_MODE=live is for viewing/working with production data from a local
    // dev server — never run schema-altering sync or starter-content seeding
    // against production from here. Local dev (the default) keeps doing both,
    // same as before.
    if (process.env.DB_MODE === "live") {
      console.log(
        "DB_MODE=live — skipping sync/seed, connected read/write to production data as-is",
      );
    } else {
      await sequelize.sync({ alter: true });
      console.log("Database synced");
      await seedCmsPages();
      await seedStarterContent();
      // Writes (marks abandoned prepaid orders "payment_failed") — same
      // reasoning as sync/seed above, never run against production from a
      // local DB_MODE=live session.
      startAbandonedOrderCleanupJob();
    }

    const PORT = process.env.PORT || 4000;
    const httpServer = http.createServer(app);
    initSocket(httpServer);
    httpServer.listen(PORT, () => {
      console.log(`sehat-potli-backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
