const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    category: {
      type: String,
      enum: ["Full Wash", "Exterior Wash", "Interior Cleaning", "Bike Wash", "Detailing"],
      required: true,
    },
    vehicleCategory: {
      type: String,
      enum: ["Hatchback", "Sedan", "SUV", "Two wheeler"],
      required: true,
    },
    basePrice: { type: Number, required: true },
    durationMinutes: { type: Number, required: true },
    imageUrl: String,
    isPopular: { type: Boolean, default: false },
    discountPercent: { type: Number, default: 0 },
    featuresList: [String],
    rating: { type: Number, default: 0 },
    numReviews: { type: Number, default: 0 },
    reviews: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        rating: Number,
        comment: String,
      },
    ],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);