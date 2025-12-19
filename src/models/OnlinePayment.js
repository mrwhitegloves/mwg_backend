// models/OnlinePayment.js
const mongoose = require('mongoose');

const onlinePaymentSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: String,
  paymentId: String,
  signature: String,
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['created', 'paid', 'failed'],
    default: 'created'
  },
  paidAt: Date
}, { timestamps: true });

module.exports = mongoose.model('OnlinePayment', onlinePaymentSchema);