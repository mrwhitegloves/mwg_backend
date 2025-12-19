const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  method: { type: String, enum: ["Razorpay", "Cash", "Partial"], required: true },
  status: { type: String, enum: ["initiated", "success", "failed", "refunded"], default: "initiated" },
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  transactionDate: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("ServicePayment", paymentSchema);
