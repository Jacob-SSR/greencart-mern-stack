import Order from "../models/Order.js";
import Product from "../models/Product.js";
import User from "../models/user.js";
import stripePkg from "stripe";

export const placeOrderCOD = async (req, res) => {
  try {
    const { userId, items, address } = req.body;
    if (!address || items.length === 0) {
      return res.json({ success: false, message: "Invalid data" });
    }

    let amount = await items.reduce(async (acc, item) => {
      const product = await Product.findById(item.product);
      return (await acc) + product.offerPrice * item.quantity;
    }, 0);

    amount += Math.floor(amount * 0.02);

    await Order.create({
      userId,
      items,
      amount,
      address,
      paymentType: "COD",
    });

    return res.json({ success: true, message: "Order Placed Successfully" });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};
export const placeOrderStripe = async (req, res) => {
  try {
    const { userId, items, address } = req.body;
    const { origin } = req.headers;

    if (!address || items.length === 0) {
      return res.json({ success: false, message: "Invalid data" });
    }

    let productData = [];

    let amount = await items.reduce(async (acc, item) => {
      const product = await Product.findById(item.product);
      productData.push({
        name: product.name,
        price: product.offerPrice,
        quantity: item.quantity,
      });
      return (await acc) + product.offerPrice * item.quantity;
    }, 0);

    amount += Math.floor(amount * 0.02);

    const order = await Order.create({
      userId,
      items,
      amount,
      address,
      paymentType: "Online",
    });

    const stripeInstance = new stripePkg(process.env.STRIPE_SECRET_KEY);

    const line_items = productData.map((item) => {
      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
          },
          unit_amount: Math.floor(item.price + item.price * 0.02) * 100,
        },
        quantity: item.quantity,
      };
    });

    const session = await stripeInstance.checkout.sessions.create({
      line_items,
      mode: "payment",
      success_url: `${origin}/loader?next=my-orders`,
      cancel_url: `${origin}/cart`,
      metadata: {
        orderId: order._id.toString(),
        userId,
      },
    });

    return res.json({ success: true, url: session.url });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const stripeWebhooks = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // ตรวจลายเซ็น + ใช้ raw body
    event = stripeInstance.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error("❌ Webhook signature error:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      console.log("✅ Webhook: checkout.session.completed received");

      const session = event.data.object;
      const metadata = session.metadata || {};

      const orderId = metadata.orderId;
      const userId = metadata.userId;

      console.log("🧾 OrderID:", orderId);
      console.log("👤 UserID:", userId);

      if (!orderId || !userId) {
        console.warn("⚠️ Metadata missing. Order or User ID not found.");
        return res.status(400).send("Metadata is missing");
      }

      try {
        await Order.findByIdAndUpdate(orderId, { isPaid: true });
        await User.findByIdAndUpdate(userId, { cartItems: {} });

        console.log("✅ Order updated and user cart cleared.");
      } catch (error) {
        console.error("❌ Error updating DB:", error.message);
        return res.status(500).send("Database update failed");
      }

      break;
    }

    default:
      console.log(`🔸 Unhandled event type: ${event.type}`);
      break;
  }

  res.json({ received: true });
};

export const getUserOrders = async (req, res) => {
  try {
    const { userId } = req.body;
    const orders = await Order.find({
      userId,
      $or: [{ paymentType: "COD" }, { isPaid: true }],
    })
      .populate("items.product address")
      .sort({ createdAt: -1 });

    res.json({ success: true, orders });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [{ paymentType: "COD" }, { isPaid: true }],
    })
      .populate("items.product address")
      .sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};
