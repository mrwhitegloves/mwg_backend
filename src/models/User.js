const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  label: { type: String, enum: ["Home", "Office", "Other"], default: "Home" },
  street: { type: String },
  city: { type: String, required: true },
  state: String,
  postalCode: String,
  latitude: Number,
  longitude: Number,
  fullAddress: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
}, { timestamps: true });

const vehicleSchema = new mongoose.Schema({
  type: { type: String, required: true },
  make: { type: String, required: true },
  model: { type: String, required: true },
  year: { type: Number, required: true },
  registrationNumber: String,
  fuel_type: { type: String },
  color: String,
  isActive: { type: Boolean, default: true },

  // ────── NEW FIELDS FROM QuickEKYC API ──────
  rc_number: String,
  fit_up_to: Date,
  registration_date: Date,
  owner_name: String,
  father_name: String,
  present_address: String,
  permanent_address: String,
  mobile_number: String,
  vehicle_category: String,
  vehicle_chasi_number: String,
  vehicle_engine_number: String,
  maker_description: String,
  maker_model: String,
  body_type: String,
  norms_type: String,
  financer: String,
  financed: Boolean,
  insurance_company: String,
  insurance_policy_number: String,
  insurance_upto: Date,
  manufacturing_date: Date,
  registered_at: String,
  tax_upto: Date,
  tax_paid_upto: String,
  cubic_capacity: Number,
  vehicle_gross_weight: Number,
  no_cylinders: Number,
  seat_capacity: Number,
  sleeper_capacity: Number,
  standing_capacity: Number,
  wheelbase: Number,
  unladen_weight: Number,
  vehicle_category_description: String,
  pucc_number: String,
  pucc_upto: Date,
  permit_number: String,
  permit_issue_date: Date,
  permit_valid_from: Date,
  permit_valid_upto: Date,
  permit_type: String,
  national_permit_number: String,
  national_permit_upto: Date,
  national_permit_issued_by: String,
  non_use_status: String,
  non_use_from: Date,
  non_use_to: Date,
  blacklist_status: String,
  noc_details: String,
  owner_number: Number,
  rc_status: String,
  masked_name: Boolean,
  challan_details: String,
  variant: String,
  rto_code: String,
});

const deliveryAddressSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: String,
  postalCode: String,
  label: { type: String, enum: ["Home", "Office", "Other"], default: "Home" },
});

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, sparse: true },
    phone: { type: String, require: true, unique: true },
    password: String,
    profileImage: { type: String },
    addresses: [addressSchema],
    vehicles: vehicleSchema,
    deliveryAddresses: [deliveryAddressSchema],
    fcmToken: {
      type: String,
      trim: true,
      sparse: true,
    },
    role: {
      type: String,
      enum: ["customer", "partner", "franchise", "admin"],
      default: "customer",
    },
    walletBalance: { type: Number, default: 0 },
    loyaltyPoints: { type: Number, default: 0 },
    lastLogin: Date,
    isActive: { type: Boolean, default: true },

    otp: { type: String }, // 6-digit OTP
    otpExpiry: { type: Date }, // Expires in 5 min
    onboardingStep: { 
      type: String, 
      enum: ['phone', 'profile', 'vehicle', 'location', 'complete'], 
      default: 'phone' 
    }, // Tracks user progress
    // Optional: location in User for default filtering
    currentLocation: {
      type: { type: String, default: 'Point' },
      coordinates: [Number] // [latitude, longitude]
    }
  },
  { timestamps: true }
);


module.exports = mongoose.model("User", userSchema);
