// models/Partner.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Franchise = require('./Franchise');

const partnerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, unique: true, select: false },
  phone: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ },
  role: { type: String, enum: ['partner'], default: 'partner' },

  // NEW: Business Model
  businessModel: {
    type: String,
    enum: ['Franchise', 'BYOB'],
    required: true,
    default: 'Franchise'
  },

  // NEW: Service Area for BYOB partners (same structure as Franchise)
  serviceArea: {
    pincodes: [{ type: String, trim: true }],
    radius: { type: Number, default: 10 } // in km
  },

  liveLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
    updatedAt: { type: Date, default: Date.now }
  },
  address: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true, match: /^\d{6}$/ }
  },

  // Keep branch for Franchise partners only
  branch: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Franchise',
    required: function() { return this.businessModel === 'Franchise'; }
  },

  currentBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', sparse: true },
  isAvailable: { type: Boolean, default: false, index: true },
  servicesOffered: [{ type: String, enum: ['Full Wash', 'Exterior Wash', 'Interior Cleaning', 'Bike Wash', 'Detailing', 'Engine Cleaning'] }],
  vehicleCategories: [{ type: String, enum: ['Hatchback', 'Sedan', 'SUV', 'Two wheeler'] }],

  workingHours: {
    monday: { from: String, to: String },
    tuesday: { from: String, to: String },
    wednesday: { from: String, to: String },
    thursday: { from: String, to: String },
    friday: { from: String, to: String },
    saturday: { from: String, to: String },
    sunday: { from: String, to: String }
  },
  rating: { average: { type: Number, default: 0 }, totalReviews: { type: Number, default: 0 } },
  imageUrl: { type: String, default: '' },
  documents: {
    driving_license: { name: String, url: String, type: { type: String, default: 'driving_license' } },
    id_proof: { name: String, url: String, type: { type: String, default: 'id_proof' } },
    pan_card: { name: String, url: String, type: { type: String, default: 'pan_card' } },
    bank_statement: { name: String, url: String, type: { type: String, default: 'bank_statement' } },
    other: { name: String, url: String, type: { type: String, default: 'other' } }
  },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'suspended'], default: 'pending' },
  commissionPercent: { type: Number },
  active: { type: Boolean, default: true },
  fcmToken: { type: String, sparse: true },
  currentCashInHand: { type: Number, default: 0 },
  allTimeCashCollected: { type: Number, default: 0 }
}, { timestamps: true });

// Indexes
partnerSchema.index({ 'serviceArea.pincodes': 1 });
partnerSchema.index({ businessModel: 1 });
partnerSchema.index({ branch: 1 });
partnerSchema.index({ isAvailable: 1, status: 1, active: 1 });

partnerSchema.methods.comparePassword = async function (pass) {
  return await bcrypt.compare(pass, this.password);
};

// Auto-add to Franchise if businessModel === 'Franchise'
partnerSchema.post('save', async function(doc) {
  if (doc.businessModel === 'Franchise' && doc.branch) {
    await Franchise.findByIdAndUpdate(
      doc.branch,
      { $addToSet: { partners: doc._id } }
    );
  }
});

partnerSchema.post('findOneAndUpdate', async function(doc) {
  if (!doc) return;

  const updated = this.getUpdate();
  const newBranch = updated.branch || updated.$set?.branch;
  const newModel = updated.businessModel || updated.$set?.businessModel;

  // If switched from BYOB → Franchise
  if (newModel === 'Franchise' && newBranch && doc.businessModel !== 'Franchise') {
    await Franchise.findByIdAndUpdate(newBranch, { $addToSet: { partners: doc._id } });
  }

  // If switched from Franchise → BYOB or branch changed.
  if (doc.businessModel === 'Franchise') {
    const oldBranch = doc.branch;
    if (oldBranch && (!newBranch || newBranch.toString() !== oldBranch.toString())) {
      await Franchise.findByIdAndUpdate(oldBranch, { $pull: { partners: doc._id } });
    }
  }
});

partnerSchema.post('findOneAndDelete', async function (doc) {
  if (doc?.branch) {
    await Franchise.findByIdAndUpdate(
      doc.branch,
      { $pull: { partners: doc._id } }
    );
  }
});

module.exports = mongoose.model('Partner', partnerSchema);