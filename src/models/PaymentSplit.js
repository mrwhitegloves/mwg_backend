// models/PaymentSplit.js
const mongoose = require('mongoose');

const paymentSplitSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  onlineAmount: { type: Number, default: 0 },
  cashAmount: { type: Number, default: 0 },
  onlineTransactionId: { type: String },
  onlinePaidAt: { type: Date },
  cashCollectedAt: { type: Date },
  collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
  status: {
    type: String,
    enum: ['pending', 'partial', 'completed'],
    default: 'pending'
  }
}, { timestamps: true });

module.exports = mongoose.model('PaymentSplit', paymentSplitSchema);