const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");
const { Notification } = require("../models");

let io = null;

// Order notifications are an admin-facing feature only — every connection
// must present a valid admin_token cookie, same check as middleware/adminAuth.js
// but read from the handshake instead of an Express request.
function authenticateSocket(socket, next) {
  try {
    const cookies = cookie.parse(socket.handshake.headers.cookie || "");
    const token = cookies.admin_token;
    if (!token) return next(new Error("Unauthorized"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "admin") return next(new Error("Forbidden"));
    socket.admin = decoded;
    next();
  } catch (err) {
    next(new Error("Unauthorized"));
  }
}

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: [
        process.env.STORE_FRONT_URL,
        process.env.STORE_FRONT_URL2,
        process.env.STORE_ADMIN_URL,
        process.env.STORE_ADMIN_URL_LOCALE,
      ],
      credentials: true,
    },
  });

  io.use(authenticateSocket);
  io.on("connection", (socket) => {
    socket.join("admins");
  });

  return io;
}

function getIO() {
  return io;
}

// Persists a Notification row (so it survives refresh/re-login) and pushes it
// live to any connected admin clients. Called once an order is actually
// confirmed — COD at creation, prepaid only once payment is verified.
async function emitNewOrder(order) {
  const notification = await Notification.create({
    orderId: order.id,
    title: "New Order Received",
    message: `Order ${order.orderNumber} for ₹${order.total} was just placed.`,
  });

  if (io) {
    io.to("admins").emit("new-order", {
      notification: notification.toJSON(),
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
        paymentMethod: order.paymentMethod,
      },
    });
  }

  return notification;
}

module.exports = { initSocket, getIO, emitNewOrder };
