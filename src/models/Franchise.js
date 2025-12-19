const mongoose = require('mongoose');

const franchiseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    address: {
      street: { type: String, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
      postalCode: { type: String, trim: true },
      country: { type: String, required: true, trim: true, default: 'India' },
    },
    Location: {
        latitude: { type: Number },
        longitude: { type: Number }
    },
    serviceArea: {
      pincodes: [{ type: String, required: true, trim: true }],
      radius: { type: Number, default: 10 }, // in kilometers
    },
    contact: {
      phone: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
    },
    fcmToken: {
      type: String,
      trim: true,
      sparse: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser', // References AdminUser with role 'franchiseAdmin'
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    services: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service', // Link to services offered by this franchise
      },
    ],
    partners: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Partner",
        },
    ],
    operatingHours: {
      monday: { open: String, close: String }, // e.g., "09:00", "17:00"
      tuesday: { open: String, close: String },
      wednesday: { open: String, close: String },
      thursday: { open: String, close: String },
      friday: { open: String, close: String },
      saturday: { open: String, close: String },
      sunday: { open: String, close: String },
    },
  },
  { timestamps: true }
);


// Validate owner is a franchiseAdmin
franchiseSchema.pre('save', async function (next) {
  if (this.isModified('owner')) {
    const AdminUser = mongoose.model('AdminUser');
    const owner = await AdminUser.findById(this.owner);
    if (!owner || owner.role !== 'franchiseAdmin') {
      return next(new Error('Owner must be a franchiseAdmin'));
    }
  }
  next();
});

module.exports = mongoose.model('Franchise', franchiseSchema);