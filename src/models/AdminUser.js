const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['admin', 'franchiseAdmin', 'franchiseEmployee'],
      required: true,
    },
    name: { type: String, required: true },
    token: { type: String },
    // franchiseId: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: 'Franchise', // Optional: Reference to a Franchise model (if you add one later)
    //   required: function () {
    //     return this.role !== 'admin'; // Required for franchiseAdmin, franchiseEmployee
    //   },
    // },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

// Hash password before saving
adminUserSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

// Compare password for login
adminUserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('AdminUser', adminUserSchema);