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
const BlogPost = require("./BlogPost");
const Faq = require("./Faq");
const NewsletterSubscriber = require("./NewsletterSubscriber");
const ProductReview = require("./ProductReview");
const Account = require("./Account");
const VerificationToken = require("./VerificationToken");
const IntegrationSetting = require("./IntegrationSetting");
const WebSetting = require("./WebSetting");
const Notification = require("./Notification");

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

// Product <-> ProductReview
Product.hasMany(ProductReview, { as: "reviews", foreignKey: "productId", onDelete: "CASCADE" });
ProductReview.belongsTo(Product, { foreignKey: "productId" });

// Customer <-> Account (Auth.js linked OAuth identities)
Customer.hasMany(Account, { foreignKey: "userId", onDelete: "CASCADE" });
Account.belongsTo(Customer, { foreignKey: "userId" });

// Order <-> Notification (new-order admin notifications)
Order.hasMany(Notification, { foreignKey: "orderId", onDelete: "CASCADE" });
Notification.belongsTo(Order, { foreignKey: "orderId" });

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
  BlogPost,
  Faq,
  NewsletterSubscriber,
  ProductReview,
  Account,
  VerificationToken,
  IntegrationSetting,
  WebSetting,
  Notification,
};
