const mongoose = require("mongoose");
const Counter = require("./counter");

// =============================
// ENUMS (for validation & consistency)
// =============================
const VEHICLE_TYPES = ["Hatchback", "Sedan", "SUV", "Two wheeler"];
const SERVICE_TYPES = ["Full Wash", "Exterior Wash", "Interior Cleaning", "Bike Wash", "Detailing", "Engine Cleaning"];
const PAYMENT_METHODS = ["Cash", "UPI", "Card", "Wallet"];
const BOOKING_STATUS = [
  "pending",      // Customer created, awaiting payment/confirmation
  "confirmed",    // Payment done or admin approved
  "enroute",      // Partner on the way
  "arrived",      // Partner reached location
  "in-progress",  // Washing started
  "completed",    // Service finished
  "cancelled",    // Cancelled by customer/admin
  "failed"        // Payment failed / other issues
];

// =============================
// MAIN BOOKING SCHEMA
// =============================
const bookingSchema = new mongoose.Schema(
  {
    // Auto-generated unique booking ID (e.g., MWG00001)
    bookingId: {
      type: String,
      unique: true,
      sparse: true,
    },

    // Customer who placed the booking
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Service partner (car wash partner)
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      index: true,
    },

    // Branch (if multi-branch partner)
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
    },

    // Selected vehicle from customer's saved vehicles
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      // ref: "User.vehicles",
    },

    // Services requested (multiple allowed)
    services: [
      {
        serviceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Service",
          required: true,
        },
        name: { type: String, required: true },
        description: String,
        price: { type: Number, required: true },
        imageUrl: { type: String },
        featuresList: [String],
        durationMinutes: { type: Number },
      },
    ],

    // Service location (customer's address)
    serviceLocation: {
      address: { type: String, required: true },
      pincode: { type: String, required: true },
      coordinates: {
        type: [Number], // [longitude, latitude] → GeoJSON
        index: "2dsphere",
      },
      label: { type: String }, // e.g., "Home", "Office"
    },

    // Partner's pickup/start location (if different)
    partnerStartLocation: {
      address: { type: String },
      coordinates: { type: [Number], index: "2dsphere" }, // [lng, lat]
    },

    // Real-time partner tracking (updated via socket)
    partnerLiveLocation: {
      coordinates: { type: [Number], index: "2dsphere" }, // [lng, lat]
      updatedAt: { type: Date },
    },

    // Scheduled datetime
    scheduledDate: {
      type: Date,
      required: true,
      index: true,
    },
    scheduledTime: {
      type: String,
      required: true,
      // match: /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/,
    },

    // Estimated completion
    estimatedCompletion: {
      type: Date,
    },

    // Actual start & end times
    startedAt: { type: Date },
    completedAt: { type: Date },

    // Status flow
    status: {
      type: String,
      enum: BOOKING_STATUS,
      default: "pending",
      index: true,
    },

    // Cancellation details
    cancellation: {
      cancelledBy: { type: String, enum: ["customer", "partner", "admin"] },
      reason: { type: String },
      cancelledAt: { type: Date },
    },

    // Pricing
    pricing: {
      servicePrice: { type: Number, required: true },
      total: { type: Number, required: true },
      subtotal: { type: Number, required: true },
      discount: { type: Number, default: 0 },
      tax: { type: Number, default: 0 },
      charges: { type: Number, default: 0 }
    },

    // Payment type
    paymentType: {
      type: String,
      enum: ["pay after service", "pay online"],
      default: "pay after service",
    },

    // Payment mode
    paymentMode: {
      type: String,
      enum: ["online", "cash"],
      default: "online",
    },

paymentSplit: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'PaymentSplit'
},
onlinePayment: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'OnlinePayment'
},

    // Payment
    // payment: {
    //   method: { type: String, enum: PAYMENT_METHODS, required: true },
    //   status: {
    //     type: String,
    //     enum: ["pending", "paid", "failed", "refunded"],
    //     default: "pending",
    //   },
    //   transactionId: { type: String },
    //   paidAt: { type: Date },
    //   gatewayResponse: { type: mongoose.Schema.Types.Mixed },
    // },

    // Rating & feedback after completion
    rating: {
      value: { type: Number, min: 1, max: 5 },
      comment: { type: String },
      images: [{ type: String }], // Cloudinary URLs
      ratedAt: { type: Date },
    },

  // OTP
  otp: { type: String, length: 4 },

    // Metadata
    source: { type: String, enum: ["app", "web", "admin"], default: "app" },
    isRescheduled: { type: Boolean, default: false },
    rescheduleCount: { type: Number, default: 0 },

    // Timestamps
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// =============================
// INDEXES
// =============================
bookingSchema.index({ customer: 1, createdAt: -1 });
bookingSchema.index({ partner: 1, status: 1 });
bookingSchema.index({ scheduledAt: 1 });

// =============================
// VIRTUALS
// =============================
bookingSchema.virtual("durationMinutes").get(function () {
  return this.services.reduce((sum, s) => sum + s.durationMinutes, 0);
});

bookingSchema.virtual("isActive").get(function () {
  return ["pending", "confirmed", "assigned", "enroute", "arrived", "in-progress"].includes(this.status);
});

// =============================
// ────── POPULATE VEHICLE FROM User.vehicles ──────
// =============================
bookingSchema.virtual("vehicleDetails", {
  ref: "User",
  localField: "customer",
  foreignField: "_id",
  justOne: true,
});

// =============================
// FINAL & OFFICIAL: Attach vehicleDetails (Works with .lean() + Normal Docs)
// =============================
bookingSchema.post(/(find|findOne)/, async function (docs) {
  if (!docs) return;

  const bookings = Array.isArray(docs) ? docs : [docs];
  if (bookings.length === 0) return;

  try {
    // Extract customer IDs (safe for both populated & ObjectId)
    const customerIds = bookings
      .map(b => {
        if (!b.customer) return null;
        if (typeof b.customer === 'object' && b.customer._id) {
          return b.customer._id.toString();
        }
        return b.customer.toString();
      })
      .filter(Boolean);

    const uniqueCustomerIds = [...new Set(customerIds)];
    if (uniqueCustomerIds.length === 0) return;

    // Fetch users with their single vehicle
    const users = await mongoose.model("User")
      .find({ _id: { $in: uniqueCustomerIds } })
      .select('_id vehicles')
      .lean();

    // Create map: customerId → vehicle object
    const vehicleMap = {};
    users.forEach(user => {
      if (user.vehicles && typeof user.vehicles === 'object') {
        vehicleMap[user._id.toString()] = user.vehicles;
      }
    });

    // Attach vehicleDetails using direct assignment (works with .lean())
    for (const booking of bookings) {
      const custId = (booking.customer?._id || booking.customer)?.toString();

      if (!custId || !vehicleMap[custId]) {
        booking.vehicleDetails = null;
        continue;
      }

      const userVehicle = vehicleMap[custId];

      // Since only ONE vehicle per user → just attach it
      // Optional: validate the _id matches booking.vehicle
      const bookingVehicleId = booking.vehicle?.toString();
      const userVehicleId = userVehicle._id?.toString();

      if (bookingVehicleId && userVehicleId && bookingVehicleId === userVehicleId) {
        booking.vehicleDetails = userVehicle;
      } else {
        // Fallback: still attach (in case of data inconsistency)
        booking.vehicleDetails = userVehicle;
      }
    }
  } catch (error) {
    console.error("Booking vehicleDetails middleware error:", error.message);
    // Never crash the API
  }
});

// =============================
// PRE-SAVE: Auto-increment bookingId
// =============================
async function getNextSequenceValue(sequenceName) {
  const sequenceDoc = await Counter.findOneAndUpdate(
    { name: sequenceName },
    { $inc: { sequence_value: 1 } },
    { new: true, upsert: true }
  );
  return sequenceDoc.sequence_value;
}

bookingSchema.pre('save', async function (next) {
  if (this.isNew && !this.bookingId) {
    try {
      const seq = await getNextSequenceValue("bookingId");
      this.bookingId = `MWG${seq.toString().padStart(5, '0')}`;
    } catch (err) {
      return next(err);
    }
  }

  // Combine date + time
  if (this.isModified('scheduledDate') || this.isModified('scheduledTime')) {
    const [h, m] = this.scheduledTime.split(':');
    const date = new Date(this.scheduledDate);
    date.setHours(+h, +m, 0, 0);
    this.scheduledAt = date;
  }

  // Estimated completion
  if (this.scheduledAt && this.services?.length) {
    const mins = this.services.reduce((s, srv) => s + srv.durationMinutes, 0);
    this.estimatedCompletion = new Date(this.scheduledAt.getTime() + mins * 60 * 1000);
  }

  next();
});

// =============================
// EXPORT
// =============================
module.exports = mongoose.model("Booking", bookingSchema);
