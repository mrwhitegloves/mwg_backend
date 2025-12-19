const mongoose = require('mongoose');

const couponUsedSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  usedCount: { type: Number, default: 1 },
});

const couponSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['Franchise-wise', 'All'], required: true },
  pincodes: [{ type: String, trim: true }], // Only if type is 'Franchise-wise'
  code: { type: String, required: true, unique: true, uppercase: true },
  limitPerUser: { type: Number, default: 1, min: 1 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  discountType: { type: String, enum: ['Percentage', 'Flat'], required: true },
  discountValue: { type: Number, required: true, min: 0 },
  maxDiscount: { type: Number, default: 0, min: 0 }, // For Percentage type
  minAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['Active', 'Block'], default: 'Active' },
  usedBy: [couponUsedSchema],
  createdBy: { type: String, enum: ['ADMIN', 'FRANCHISE'], default: 'ADMIN' },
}, { timestamps: true });

// Indexes for fast queries
couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ status: 1 });
couponSchema.index({ startDate: 1, endDate: 1 });
couponSchema.index({ pincodes: 1 });

module.exports = mongoose.model('Coupon', couponSchema);