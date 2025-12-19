// controllers/partnerController.js
const Booking = require("../models/Booking");
const Partner = require("../models/Partner");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const PaymentSplit = require("../models/PaymentSplit");
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else if (
      file.fieldname === "documents" &&
      ["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)
    )
      cb(null, true);
    else cb(new Error("Invalid file type"), false);
  },
});

const uploadSingleToCloudinary = (file, folder) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      return resolve(null);
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: file.mimetype.includes('pdf') ? 'raw' : 'image',
        folder
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            name: file.originalname,
            url: result.secure_url
          });
        }
      }
    );

    stream.end(file.buffer);
  });
};

// LOGIN PARTNER
exports.loginPartner = async (req, res) => {
  try {
    const { emailOrPhone, password } = req.body;
    let partner;
    const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (isValidEmail(emailOrPhone)) {
      const email = emailOrPhone;
      partner = await Partner.findOne({ email }).select("+password");
    } else {
      const phone = emailOrPhone;
      partner = await Partner.findOne({ phone }).select("+password");
    }

    if (!partner || partner.password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: partner._id, role: "partner" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Set HTTP-only cookie
    res.cookie("partnerToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // Secure in production
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      token,
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
};

exports.logoutPartner = async (req, res) => {
  try {
    const user = await Partner.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Partner not found' });

    // Clear FCM token → stop push notifications
    user.fcmToken = undefined;
    await user.save();

    res.json({ 
      message: 'Logged out successfully',
      // Frontend will delete AsyncStorage token
    });
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};


// CREATE PARTNER
// CREATE PARTNER – Updated for BYOB + Franchise
exports.createPartner = [
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'driving_license', maxCount: 1 },
    { name: 'id_proof', maxCount: 1 },
    { name: 'pan_card', maxCount: 1 },
    { name: 'bank_statement', maxCount: 1 },
    { name: 'other', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { name, email, password, phone, address, servicesOffered, vehicleCategories, workingHours, commissionPercent, branch, businessModel = 'Franchise', serviceArea, status } = req.body;

      console.log("Create Partner Body:", req.body);

      if (!name || !email || !password || !phone || !address || !serviceArea || !businessModel) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Validate business model logic
      let parsedServiceArea = null;
      if (serviceArea) {
        try {
          parsedServiceArea = JSON.parse(serviceArea);
        } catch (e) {
          return res.status(400).json({ error: "Invalid serviceArea JSON" });
        }
      }

      if (businessModel === 'BYOB') {
        if (!parsedServiceArea?.pincodes?.length) {
          return res.status(400).json({ error: "BYOB partner must have serviceArea.pincodes" });
        }
      } else if (businessModel === 'Franchise') {
        if (!branch) {
          return res.status(400).json({ error: "Franchise partner must have branch" });
        }
      }

      const imageUrl = req.files['image']?.[0]
        ? (await uploadSingleToCloudinary(req.files['image'][0], 'partners'))?.url
        : "";

      const docTypes = ['driving_license', 'id_proof', 'pan_card', 'bank_statement', 'other'];
      const documents = {};

      for (const type of docTypes) {
        const file = req.files[type]?.[0];
        if (file) {
          const uploaded = await uploadSingleToCloudinary(file, 'partner_docs');
          documents[type] = { ...uploaded, type };
        }
      }

      const partner = new Partner({
        name, email, password, phone,
        address: JSON.parse(address),
        servicesOffered: JSON.parse(servicesOffered),
        vehicleCategories: JSON.parse(vehicleCategories),
        workingHours: workingHours ? JSON.parse(workingHours) : {},
        commissionPercent: parseFloat(commissionPercent) || 0,
        businessModel,
        branch: businessModel === 'Franchise' ? branch : undefined,
        serviceArea: parsedServiceArea || undefined,
        imageUrl,
        documents,
        role: "partner",
        status: status || 'pending',
      });

      await partner.save();

      const { password: _, ...safePartner } = partner.toObject();
      res.status(201).json({ message: "Partner created", partner: safePartner });
    } catch (error) {
      console.error("Create Partner Error:", error);
      res.status(500).json({ error: "Server error" });
    }
  },
];

// GET /partners/me
exports.getPartnerMe = async (req, res) => {
  try {
    const partner = await Partner.findById(req.user.userId)
      .select('-password')
      .populate('branch', 'name');
    res.json({ partner });
  } catch (err) {
    console.error("getPartnerMe error:", err);
    res.status(500).json({ error: 'Server error' });
  }
};

// UPDATE /partners/me – ONLY PROFILE PHOTO ALLOWED
exports.updatePartnerImage = [
  upload.single('image'), // Only accept 'image' field
  async (req, res) => {
    try {
      const partner = await Partner.findById(req.user.userId);
      if (!partner) {
        return res.status(404).json({ error: "Partner not found" });
      }

      // BLOCK ALL UPDATES EXCEPT IMAGE
      if (Object.keys(req.body).length > 0) {
        return res.status(403).json({
          error: "You can only update your profile picture. Other details must be updated by admin."
        });
      }

      // If no image → just return current profile
      if (!req.file) {
        return res.json({
          message: "No image uploaded",
          partner: await Partner.findById(req.user.userId).select('-password').populate('branch', 'name')
        });
      }

      // Delete old image from Cloudinary
      if (partner.imageUrl) {
        const publicId = partner.imageUrl.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(publicId).catch(() => console.log("Old image already deleted"));
      }

      // Upload new image
      const uploaded = await uploadSingleToCloudinary(req.file, 'partners');
      if (!uploaded?.url) {
        return res.status(500).json({ error: "Image upload failed" });
      }

      // Update only imageUrl
      partner.imageUrl = uploaded.url;
      await partner.save();

      // Return updated partner
      const updatedPartner = await Partner.findById(req.user.userId)
        .select('-password')
        .populate('branch', 'name');

      res.json({
        message: "Profile picture updated successfully",
        partner: updatedPartner
      });

    } catch (err) {
      console.error("updatePartnerMe error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
];

// UPDATE /partners/me – supports businessModel & serviceArea
exports.updatePartnerMe = async (req, res) => {
  try {
    const updates = { ...req.body };

    // Parse JSON fields
    ['address', 'servicesOffered', 'vehicleCategories', 'workingHours', 'serviceArea'].forEach(field => {
      if (updates[field]) {
        try {
          updates[field] = JSON.parse(updates[field]);
        } catch (e) {
          // ignore if not JSON
        }
      }
    });

    const partner = await Partner.findByIdAndUpdate(
      req.user.userId,
      updates,
      { new: true, runValidators: true }
    ).populate('branch', 'name');

    res.json({ partner });
  } catch (err) {
    console.error("updatePartnerMe error:", err);
    res.status(500).json({ error: 'Update failed' });
  }
};

// UPDATE PARTNER
exports.updatePartner = [
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'driving_license', maxCount: 1 },
    { name: 'id_proof', maxCount: 1 },
    { name: 'pan_card', maxCount: 1 },
    { name: 'bank_statement', maxCount: 1 },
    { name: 'other', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const partner = await Partner.findById(req.params.id);
      if (!partner) return res.status(404).json({ error: "Partner not found" });

      const updateData = { ...req.body };

      // Handle image
      if (req.files['image']?.[0]) {
        if (partner.imageUrl) {
          const oldId = partner.imageUrl.split("/").pop().split(".")[0];
          await cloudinary.uploader.destroy(oldId);
        }
        updateData.imageUrl = (await uploadSingleToCloudinary(req.files['image'][0], 'partners'))?.url;
      }

      // Handle documents
      const docTypes = ['driving_license', 'id_proof', 'pan_card', 'bank_statement', 'other'];
      updateData.documents = partner.documents || {};

      for (const type of docTypes) {
        const file = req.files[type]?.[0];
        if (file) {
          // Delete old
          if (updateData.documents[type]?.url) {
            const oldId = updateData.documents[type].url.split("/").pop().split(".")[0];
            await cloudinary.uploader.destroy(oldId);
          }
          const uploaded = await uploadSingleToCloudinary(file, 'partner_docs');
          updateData.documents[type] = { ...uploaded, type };
        }
      }

      // Parse JSON fields
      ['address', 'servicesOffered', 'vehicleCategories', 'workingHours'].forEach(field => {
        if (updateData[field]) updateData[field] = JSON.parse(updateData[field]);
      });

      // Special handling for businessModel & branch
      if (updateData.businessModel) {
        if (updateData.businessModel === 'BYOB') {
          updateData.branch = undefined;
        }
        // Franchise → will be handled by post-save hook
      }

      const updated = await Partner.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
      res.json({ message: "Partner updated", partner: updated });
    } catch (error) {
      res.status(500).json({ error: "Server error" });
    }
  },
];

// DELETE, GET ALL, GET BY ID (same logic, just model changed)
exports.deletePartner = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    // Delete images from Cloudinary (SAME LOGIC)
    if (partner.imageUrl) {
      const publicId = partner.imageUrl.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    }

    // Delete documents
    for (let doc of partner.documents) {
      const publicId = doc.url.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    }

    await Partner.findByIdAndDelete(req.params.id);

    res.json({ message: "Partner deleted successfully" });
  } catch (error) {
    console.error("Delete Partner Error:", error);
    res.status(500).json({ error: "Server error while deleting partner" });
  }
};

exports.getAllPartners = async (req, res) => {
  const {
    page = 1,
    limit = 10,
    search = "",
    city = "",
    state = "",
    status = "",
    servicesOffered = "",
    rating = "",
    active = "true",
  } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  try {
    // Build filter
    let filter = { active: active === "true" };

    if (status) filter.status = status;
    if (city) filter["address.city"] = { $regex: city, $options: "i" };
    if (state) filter["address.state"] = { $regex: state, $options: "i" };
    if (servicesOffered) filter.servicesOffered = servicesOffered;
    if (rating) filter["rating.average"] = { $gte: parseFloat(rating) };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (pageNum - 1) * limitNum;

    // Get partners
    const partners = await Partner.find(filter)
      .select("-documents") // Hide documents in list
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const totalPartners = await Partner.countDocuments(filter);

    res.json({
      partners,
      pagination: {
        current: pageNum,
        pages: Math.ceil(totalPartners / limitNum),
        total: totalPartners,
        limit: limitNum,
        hasNext: pageNum * limitNum < totalPartners,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("Get Partners Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

exports.updatePushToken = async (req, res) => {
  try {
    console.log("test 1 in updatePushToken:- ", req.body);
    const { pushToken } = req.body;
    console.log("test 2 in updatePushToken:- ", pushToken)
    await Partner.findByIdAndUpdate(req.user.userId, { 
      fcmToken: pushToken 
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save push token', err: err.message });
  }
};

exports.getPartnerById = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }
    res.json({ partner });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.getEarnings = async (req, res) => {
  try {
    const partnerId = req.user.userId;
    const bookings = await Booking.find({ partner: partnerId, status: 'completed' });

    const total = bookings.reduce((sum, b) => sum + b.pricing.total, 0);
    const today = new Date().setHours(0, 0, 0, 0);
    const weekStart = new Date(today - 6 * 24 * 60 * 60 * 1000);

    const todayEarnings = bookings
      .filter(b => new Date(b.completedAt) >= new Date(today))
      .reduce((sum, b) => sum + b.pricing.total, 0);

    const weekEarnings = bookings
      .filter(b => new Date(b.completedAt) >= weekStart)
      .reduce((sum, b) => sum + b.pricing.total, 0);

    res.json({
      total,
      today: todayEarnings,
      week: weekEarnings,
      completedCount: bookings.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET ALL BOOKINGS FOR THIS PARTNER (with pagination)
exports.getAllPartnerBookings = async (req, res) => {
  try {
    const partnerId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const bookings = await Booking.find({ partner: partnerId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer', 'name phone')
      .populate('services.serviceId', 'name')
      .lean();

    const total = await Booking.countDocuments({ partner: partnerId });

    res.json({
      success: true,
      bookings,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + bookings.length < total,
      },
    });
  } catch (err) {
    console.error('getAllPartnerBookings error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// controllers/partnerController.js
exports.getPartnerBookings = async (req, res) => {
  try {
    const partnerId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const bookings = await Booking.find({ partner: partnerId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer', 'name phone')
      .populate('services.service', 'name');

    const total = await Booking.countDocuments({ partner: partnerId });

    res.json({
      bookings,
      hasMore: skip + bookings.length < total,
      page,
      total,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// NEW API: Get today's bookings for the partner
exports.getTodayBookings = async (req, res) => {
  try {
    const partnerId = req.user.userId;

    // Get start and end of today (Indian time)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const bookings = await Booking.find({
      partner: partnerId,
      scheduledDate: {
        $gte: today,
        $lt: tomorrow,
      },
    })
      .sort({ scheduledTime: 1 })
      .populate('customer', 'name phone')
      .populate('services.serviceId', 'name')
      .lean();

    res.json({
      success: true,
      count: bookings.length,
      bookings,
    });
  } catch (err) {
    console.error('getTodayBookings error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

// 1. Dashboard Summary (Performance + Revenue)
exports.getPartnerDashboard = async (req, res) => {
  try {
    const partnerId = req.user.userId;

    const bookings = await Booking.find({ partner: partnerId });

    const totalBookings = bookings.length;
    const completed = bookings.filter(b => b.status === 'completed').length;
    const pending = bookings.filter(b => ['pending', 'confirmed'].includes(b.status)).length;
    const cancelled = bookings.filter(b => b.status === 'cancelled').length;

    const totalRevenue = bookings
      .filter(b => b.status === 'completed')
      .reduce((sum, b) => sum + (b.pricing?.total || 0), 0);

    const pendingRevenue = bookings
      .filter(b => ['pending', 'confirmed', 'in-progress', 'arrived', 'enroute'].includes(b.status))
      .reduce((sum, b) => sum + (b.pricing?.total || 0), 0);

    res.json({
      performance: { totalBookings, completed, pending, cancelled },
      revenue: { totalRevenue, pendingRevenue },
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// 2. Monthly Earnings (Last 30 Days)
exports.getMonthlyEarnings = async (req, res) => {
  try {
    const partnerId = req.user.userId;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const monthlyEarnings = await Booking.aggregate([
      {
        $match: {
          partner: new mongoose.Types.ObjectId(partnerId),
          status: 'completed',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$pricing.total' }
        }
      }
    ]);
    const earnings = monthlyEarnings.length > 0 ? monthlyEarnings[0].total : 0;

    res.json({
      currentMonthEarnings: earnings
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// 3. Last 30 Days Status History
exports.getStatusHistory = async (req, res) => {
  try {
    const partnerId = req.user.userId;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const history = await Booking.aggregate([
      {
        $match: {
          partner: new mongoose.Types.ObjectId(partnerId),
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%b %d', date: '$createdAt' } },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id': 1 } },
      { $limit: 10 }
    ]);

    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET SINGLE BOOKING DETAILS
exports.getBookingDetails = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      partner: req.user.userId
    })
      .populate('customer', 'name phone')
      .populate('services.serviceId', 'name imageUrl price')
      .populate({
        path: 'paymentSplit', // This brings in PaymentSplit
        select: 'onlineAmount cashAmount onlineTransactionId onlinePaidAt cashCollectedAt status',
        populate: {
          path: 'collectedBy',
          select: 'name phone' // if you want who collected cash
        }
      })
      .lean({ virtuals: true });

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    res.json({ booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Helper function (add this once in your socket utils or controller)
const emitBookingUpdate = (io, bookingId, status, message = null) => {
  io.to(`booking:${bookingId}`).emit('bookingStatusUpdate', {
    bookingId,
    status,
    message: message || `${status.replace('-', ' ')} now`,
    timestamp: new Date()
  });
};

// START SERVICE → enroute
exports.startService = async (req, res) => {
  try {
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, partner: req.user.userId, status: 'confirmed' },
      { status: 'enroute' },
      { new: true }
    );
    if (!booking) return res.status(400).json({ message: 'Cannot start' });

    // Socket emit to customer
    emitBookingUpdate(global.io, booking._id, 'enroute', 'Partner is on the way!');

    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// MARK ARRIVED
exports.markArrived = async (req, res) => {
  try {
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, partner: req.user.userId, status: 'enroute' },
      { status: 'arrived' },
      { new: true }
    );

    emitBookingUpdate(global.io, booking._id, 'arrived');

    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// VERIFY OTP → Start Service (in-progress)
exports.verifyOtpAndStartService = async (req, res) => {
  try {
    const { otp } = req.body;
    console.log(`Verifying OTP: ${otp} for booking ${req.params.id}`);
    console.log('Partner ID:', req.user);
    const booking = await Booking.findOne({
      _id: req.params.id,
      partner: req.user.userId,
      status: 'arrived'
    });

    if (!booking) return res.status(400).json({ message: 'Invalid state' });
    if (booking.otp !== otp) return res.status(400).json({ message: 'Invalid OTP' });

    await Booking.findByIdAndUpdate(booking._id, {
      status: 'in-progress',
      otpVerifiedAt: new Date()
    });

    emitBookingUpdate(global.io, booking._id, 'in-progress');

    res.json({ success: true });
  } catch (err) {
    console.log("error in verifyOtpAndStartService: ", err)
    res.status(500).json({ error: err.message });
  }
};

// COLLECT PAYMENT (Full Cash / Split Cash Part)
exports.collectPayment = async (req, res) => {
  try {
    console.log("test 1")
    const { bookingId } = req.params;
    const { paymentMode, onlineAmount = 0, cashAmount } = req.body;
    const partnerId = req.user.userId; // assuming auth middleware sets this
    console.log("test 2")
    console.log("Payment Mode:", paymentMode, "Online Amount:", onlineAmount, "Cash Amount:", cashAmount)

    // Validate cashAmount
    if ((paymentMode === 'full-cash' || paymentMode === 'split') && (!cashAmount || cashAmount <= 0)) {
      console.log("test 3")
      return res.status(400).json({ message: 'Cash amount is required and must be > 0' });
    }
    console.log("test 4")

    const booking = await Booking.findById(bookingId).populate('partner');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (booking.status !== 'in-progress') return res.status(400).json({ message: 'Service not in progress' });

    // === 1. Handle PaymentSplit ===
    let split = await PaymentSplit.findOne({ booking: bookingId });
    if (!split) {
      split = new PaymentSplit({ booking: bookingId });
    }

    let cashCollectedThisTime = 0;

    if (paymentMode === 'full-online') {
      split.onlineAmount = booking.pricing.total;
      split.status = 'completed';
    } 
    else if (paymentMode === 'full-cash') {
      split.cashAmount = booking.pricing.total;
      cashCollectedThisTime = booking.pricing.total;
      split.cashCollectedAt = new Date();
      split.collectedBy = partnerId;
      split.status = 'completed';
    } 
    else if (paymentMode === 'split') {
      split.onlineAmount = onlineAmount;
      split.cashAmount = cashAmount;
      cashCollectedThisTime = cashAmount;
      split.cashCollectedAt = new Date();
      split.collectedBy = partnerId;
      split.status = (onlineAmount + cashAmount >= booking.pricing.total) ? 'completed' : 'partial';
    }

    await split.save();

    // === 2. UPDATE PARTNER CASH FIELDS (Only if cash was collected) ===
    if (cashCollectedThisTime > 0) {
      await Partner.findByIdAndUpdate(
        partnerId,
        {
          $inc: {
            currentCashInHand: cashCollectedThisTime,
            allTimeCashCollected: cashCollectedThisTime
          }
        },
        { new: true }
      );
    }

    // === 3. Mark booking as completed if payment is full ===
    if (split.status === 'completed') {
      await Booking.findByIdAndUpdate(bookingId, {
        status: 'completed',
        completedAt: new Date()
      });

      // Emit socket event
      if (global.io) {
        global.io.to(`booking_${booking._id}`).emit('bookingUpdate', {
          status: 'completed',
          message: 'Your car is sparkling clean!'
        });
      }
    }

    res.json({
      success: true,
      message: 'Payment collected successfully',
      cashAdded: cashCollectedThisTime,
      split
    });

  } catch (err) {
    console.error("Error in collectPayment:", err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/partner/payments
  exports.getAllPayments = async (req, res) => {
  try {
    const partnerId = req.user.userId; // assuming authMiddleware sets req.user

    const bookings = await Booking.find({
      partner: partnerId,
      status: 'completed'
    })
      .populate({
        path: 'paymentSplit',
        select: 'onlineAmount cashAmount status onlinePaidAt cashCollectedAt'
      })
      .populate({
        path: 'customer',
        select: 'name phone'
      })
      .populate({
        path: 'services.serviceId',
        select: 'name'
      })
      .select({
        bookingId: 1,
        scheduledDate: 1,
        scheduledTime: 1,
        pricing: 1,
        paymentType: 1,
        paymentMode: 1,
        createdAt: 1,
        paymentSplit: 1,
        customer: 1,
        services: 1
      })
      .sort({ completedAt: -1 })
      .lean();

    // Calculate totals
    let totalEarnings = 0;
    let onlineEarnings = 0;
    let cashEarnings = 0;
    let totalBookings = bookings.length;

    const formattedBookings = bookings.map(booking => {
      const split = booking.paymentSplit || {};
      const onlineAmt = split.onlineAmount || 0;
      const cashAmt = split.cashAmount || 0;
      const payableToPartner = onlineAmt + cashAmt;

      totalEarnings += payableToPartner;
      onlineEarnings += onlineAmt;
      cashEarnings += cashAmt;

      return {
        id: booking._id,
        bookingId: booking.bookingId,
        date: new Date(booking.scheduledDate).toLocaleDateString('en-IN'),
        time: booking.scheduledTime,
        serviceName: booking.services[0]?.serviceId?.name || 'Car Wash',
        totalAmount: booking.pricing.total,
        payableAmount: payableToPartner,
        onlineAmount: onlineAmt,
        cashAmount: cashAmt,
        paymentType: booking.paymentType,
        status: split.status || 'pending',
        customerName: booking.customer?.name || 'Customer',
      };
    });

    res.json({
      success: true,
      summary: {
        totalEarnings,
        onlineEarnings,
        cashEarnings,
        totalBookings
      },
      bookings: formattedBookings
    });

  } catch (error) {
    console.error("Partner payments fetch error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch payments" });
  }
};

const getDocType = (name) => {
  const n = name.toLowerCase();
  if (n.includes("license") || n.includes("driving")) return "driving_license";
  if (n.includes("aadhar") || n.includes("id") || n.includes("voter"))
    return "id_proof";
  if (n.includes("pan")) return "pan_card";
  if (n.includes("bank")) return "bank_statement";
  return "other";
};
