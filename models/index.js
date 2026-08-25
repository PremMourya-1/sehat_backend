const { sequelize } = require("../config/db");
const Admin = require("./Admin");
const Customer = require("./Customer");
const Category = require("./Category");
const Product = require("./Product");
const ProductImage = require("./ProductImage");
const ProductVariant = require("./ProductVariant");
const Cart = require("./Cart");
const CartItem = require("./CartItem");
const Order = require("./Order");
const OrderItem = require("./OrderItem");
const HeroBanner = require("./HeroBanner");
const Coupon = require("./Coupon");
const Testimonial = require("./Testimonial");
const CmsPage = require("./CmsPage");
const ComboOffer = require("./ComboOffer");
const ComboOfferItem = require("./ComboOfferItem");
const BlogPost = require("./BlogPost");
const Faq = require("./Faq");
const NewsletterSubscriber = require("./NewsletterSubscriber");
const ProductReview = require("./ProductReview");
const Account = require("./Account");
const VerificationToken = require("./VerificationToken");
const IntegrationSetting = require("./IntegrationSetting");
const WebSetting = require("./WebSetting");
const Notification = require("./Notification");
const ShippingZone = require("./ShippingZone");
const ShiprocketWebhookLog = require("./ShiprocketWebhookLog");
const Expense = require("./Expense");
const Sale = require("./Sale");
const CartRewardTier = require("./CartRewardTier");

// Category <-> Product
Category.hasMany(Product, { foreignKey: "categoryId" });
Product.belongsTo(Category, { foreignKey: "categoryId" });

// Product <-> ProductImage
Product.hasMany(ProductImage, { as: "images", foreignKey: "productId", onDelete: "CASCADE" });
ProductImage.belongsTo(Product, { foreignKey: "productId" });

// Product <-> ProductVariant (NEW — weight-based variants)
Product.hasMany(ProductVariant, { as: "variants", foreignKey: "productId", onDelete: "CASCADE" });
ProductVariant.belongsTo(Product, { foreignKey: "productId" });

// Customer <-> Cart
Customer.hasOne(Cart, { foreignKey: "customerId" });
Cart.belongsTo(Customer, { foreignKey: "customerId" });

// Cart <-> CartItem
Cart.hasMany(CartItem, { foreignKey: "cartId", onDelete: "CASCADE" });
CartItem.belongsTo(Cart, { foreignKey: "cartId" });

// Product <-> CartItem
Product.hasMany(CartItem, { foreignKey: "productId" });
CartItem.belongsTo(Product, { foreignKey: "productId" });

// ProductVariant <-> CartItem (NEW)
ProductVariant.hasMany(CartItem, { foreignKey: "variantId" });
CartItem.belongsTo(ProductVariant, { as: "variant", foreignKey: "variantId" });

// Customer <-> Order
Customer.hasMany(Order, { foreignKey: "customerId" });
Order.belongsTo(Customer, { foreignKey: "customerId" });

// Order <-> OrderItem
Order.hasMany(OrderItem, { foreignKey: "orderId", onDelete: "CASCADE" });
OrderItem.belongsTo(Order, { foreignKey: "orderId" });

// Product <-> OrderItem
Product.hasMany(OrderItem, { foreignKey: "productId" });
OrderItem.belongsTo(Product, { foreignKey: "productId" });

// ProductVariant <-> OrderItem (NEW)
ProductVariant.hasMany(OrderItem, { foreignKey: "variantId" });
OrderItem.belongsTo(ProductVariant, { as: "variant", foreignKey: "variantId" });

// ComboOffer <-> ComboOfferItem (the products a combo bundles)
ComboOffer.hasMany(ComboOfferItem, { as: "items", foreignKey: "comboOfferId", onDelete: "CASCADE" });
ComboOfferItem.belongsTo(ComboOffer, { foreignKey: "comboOfferId" });

// Product / ProductVariant <-> ComboOfferItem
Product.hasMany(ComboOfferItem, { foreignKey: "productId" });
ComboOfferItem.belongsTo(Product, { foreignKey: "productId" });
ProductVariant.hasMany(ComboOfferItem, { foreignKey: "variantId" });
ComboOfferItem.belongsTo(ProductVariant, { as: "variant", foreignKey: "variantId" });

// ComboOffer <-> OrderItem — nullable tag noting which combo an order line
// came from (see utils/calculateSubtotal.js). SET NULL, not CASCADE: a
// combo being edited/deleted later must never delete historical order
// records — the OrderItem still stands on its own real productId/variantId.
ComboOffer.hasMany(OrderItem, { foreignKey: "comboOfferId", onDelete: "SET NULL" });
OrderItem.belongsTo(ComboOffer, { foreignKey: "comboOfferId" });

// Product / ProductVariant <-> CartRewardTier (the free gift a tier gives)
Product.hasMany(CartRewardTier, { foreignKey: "giftProductId" });
CartRewardTier.belongsTo(Product, { as: "giftProduct", foreignKey: "giftProductId" });
ProductVariant.hasMany(CartRewardTier, { foreignKey: "giftVariantId" });
CartRewardTier.belongsTo(ProductVariant, { as: "giftVariant", foreignKey: "giftVariantId" });

// CartRewardTier <-> OrderItem — same SET NULL reasoning as ComboOffer
// above: a tier being edited/deleted later must never delete the
// historical free-gift order record.
CartRewardTier.hasMany(OrderItem, { foreignKey: "rewardTierId", onDelete: "SET NULL" });
OrderItem.belongsTo(CartRewardTier, { as: "rewardTier", foreignKey: "rewardTierId" });

// Product <-> ProductReview
Product.hasMany(ProductReview, { as: "reviews", foreignKey: "productId", onDelete: "CASCADE" });
ProductReview.belongsTo(Product, { foreignKey: "productId" });

// Customer <-> Account (Auth.js linked OAuth identities)
Customer.hasMany(Account, { foreignKey: "userId", onDelete: "CASCADE" });
Account.belongsTo(Customer, { foreignKey: "userId" });

// Order <-> Notification (new-order admin notifications)
Order.hasMany(Notification, { foreignKey: "orderId", onDelete: "CASCADE" });
Notification.belongsTo(Order, { foreignKey: "orderId" });

// Order <-> ShiprocketWebhookLog (raw webhook audit trail — orderId is
// nullable so an unmatched webhook still gets logged, hence no onDelete
// cascade here: a log row should outlive the order it referenced).
Order.hasMany(ShiprocketWebhookLog, { foreignKey: "orderId" });
ShiprocketWebhookLog.belongsTo(Order, { foreignKey: "orderId" });

module.exports = {
  sequelize,
  Admin,
  Customer,
  Category,
  Product,
  ProductImage,
  ProductVariant,
  Cart,
  CartItem,
  Order,
  OrderItem,
  HeroBanner,
  Coupon,
  Testimonial,
  CmsPage,
  ComboOffer,
  ComboOfferItem,
  BlogPost,
  Faq,
  NewsletterSubscriber,
  ProductReview,
  Account,
  VerificationToken,
  IntegrationSetting,
  WebSetting,
  Notification,
  ShippingZone,
  ShiprocketWebhookLog,
  Expense,
  Sale,
  CartRewardTier,
};
