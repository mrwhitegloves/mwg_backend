// controllers/bookingController.js
const Booking = require("../models/Booking");
const User = require("../models/User");
const Franchise = require("../models/Franchise");
const Partner = require("../models/Partner");
const PaymentSplit = require("../models/PaymentSplit");
const OnlinePayment = require("../models/OnlinePayment");
const { sendPushNotification } = require("../utils/sendPushNotification");
const Coupon = require("../models/Coupon");

/**
 * CREATE BOOKING – With Delivery Address + Payment Options
 */
exports.createBooking = async (req, res) => {
  try {
    const { userId } = req.user;
    const {
      services,
      scheduledDate, // YYYY-MM-DD
      scheduledTime, // HH:MM
      deliveryAddressId, // Optional: ID from user.deliveryAddresses
      address, // Required if no deliveryAddressId
      location, // { latitude, longitude } – required if no deliveryAddressId
      vehicleId,
      paymentType = "pay after service", // default
      paymentMode = "online", // default
    } = req.body;

    // === VALIDATION ===
    if (!services?.length || !vehicleId || !scheduledDate || !scheduledTime) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!deliveryAddressId && (!address || !location)) {
      return res.status(400).json({
        error: "Address and location required if no deliveryAddressId",
      });
    }

    // === 1. FIND CUSTOMER ===
    const customer = await User.findById(userId)
      .select("name phone fcmToken deliveryAddresses addresses")
      .populate("vehicles", "type make model year");

    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // === 2. VALIDATE VEHICLE ===
    if (!customer.vehicles || customer.vehicles._id.toString() !== vehicleId) {
      return res.status(400).json({ error: "Invalid vehicles ID" });
    }

    const vehicle = customer.vehicles;

    // === 3. RESOLVE SERVICE LOCATION ===
    let serviceLocationObj = {};
    let pincode = null;

    if (deliveryAddressId) {
      const deliveryAddr = customer.deliveryAddresses.id(deliveryAddressId);
      if (!deliveryAddr) {
        return res.status(400).json({ error: "Invalid delivery address ID" });
      }
      pincode = deliveryAddr.postalCode;
      serviceLocationObj = {
        address: `${deliveryAddr.street}, ${deliveryAddr.city}, ${
          deliveryAddr.state || ""
        } ${deliveryAddr.postalCode || ""}`.trim(),
        coordinates: [], // will try to use saved lat/lng if exists in addresses
        label: deliveryAddr.label,
        pincode,
      };
    } else {
      pincode = extractPincode(address);
      if (!pincode)
        return res.status(400).json({ error: "Invalid pincode in address" });
      serviceLocationObj = {
        address,
        coordinates: [location.longitude, location.latitude],
        pincode,
      };
    }
    console.log("services:- ", services);

    // === 5. CALCULATE PRICING ===
    const subtotal = services.reduce((sum, s) => sum + s.price, 0);
    const servicePrice = services.reduce((sum, s) => sum + s.servicePrice, 0);
    const tax = services.reduce((sum, s) => sum + s?.tax, 0);
    const charges = services.reduce((sum, s) => sum + s?.charges, 0);
    const discount = services.reduce((sum, s) => sum + s?.discount || 0, 0);
    // const commissionPercent = 20;
    // const commissionAmount = subtotal * (commissionPercent / 100);

    const otp = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit OTP

    // === 6. CREATE BOOKING ===
    const booking = new Booking({
      customer: userId,
      vehicle: vehicleId,
      services,
      serviceLocation: serviceLocationObj,
      scheduledDate: new Date(scheduledDate),
      scheduledTime,
      paymentType,
      paymentMode,
      pricing: {
        subtotal,
        total: subtotal,
        servicePrice,
        tax,
        charges,
        discount,
      },
      status: "pending",
      otp,
    });

    await booking.save();

    if (services[0]?.couponCode) {
      const coupon = await Coupon.findOne({
        code: services[0].couponCode.toUpperCase(),
        status: "Active",
      });
      if (!coupon) return res.status(400).json({ error: "Invalid coupon" });

      // Check usage limit
      const userUsage = coupon.usedBy.find(
        (u) => u.userId.toString() === userId.toString()
      );
      if (userUsage && userUsage.usedCount >= coupon.limitPerUser) {
        return res.status(400).json({ error: "Coupon already used" });
      }

      // Update usage
      if (userUsage) {
        userUsage.usedCount += 1;
      } else {
        coupon.usedBy.push({ userId, usedCount: 1 });
      }
      await coupon.save();
    }

    // === LINK BOOKING TO ONLINE PAYMENT (if exists) ===
    if (req.body.onlinePaymentId) {
      const payment = await OnlinePayment.findById(req.body.onlinePaymentId);
      if (!payment || payment.status !== "paid") {
        return res.status(400).json({ error: "Invalid payment" });
      }

      // LINK BOTH WAYS
      booking.onlinePayment = req.body.onlinePaymentId;
      payment.booking = booking._id; // ← SAVE booking._id in OnlinePayment
      await payment.save();
      await booking.save(); // re-save booking with onlinePayment
    }

    // After booking.save()
    let paymentSplit = null;

    if (paymentType === "pay after service") {
      paymentSplit = new PaymentSplit({
        booking: booking._id,
        cashAmount: booking.pricing.total,
        status: "pending",
      });
    } else if (paymentType === "pay online") {
      paymentSplit = new PaymentSplit({
        booking: booking._id,
        onlineAmount: booking.pricing.total,
        onlineTransactionId: req.body.onlinePaymentId,
        onlinePaidAt: new Date(),
        status: "completed",
      });
    }

    if (paymentSplit) {
      await paymentSplit.save();
      booking.paymentSplit = paymentSplit._id;
      await booking.save();
    }

    // push socket message to franchise partners
    // global.pushNewBooking(booking);

    // === 7. POPULATE RESPONSE ===
    await booking.populate([
      { path: "customer", select: "name phone" },
      { path: "branch", select: "name" },
      {
        path: "vehicle",
        model: "User",
        select: "type make model year registrationNumber color",
      },
    ]);

    console.log("Booking pincode:", pincode);

    // === 8. NOTIFY ALL AVAILABLE PARTNERS ====
    const availablePartners = await Partner.find({
      "serviceArea.pincodes": pincode,
      isAvailable: true,
      status: "approved",
      active: true,
      fcmToken: { $exists: true, $ne: null },
    }).select("fcmToken name _id");

    console.log(
      "Available partners for pincode",
      pincode,
      ":",
      availablePartners
    );

    const partnerTokens = availablePartners
      .map((p) => p.fcmToken)
      .filter(Boolean);

    if (partnerTokens.length > 0) {
      await sendPushNotification(
        partnerTokens,
        "New Booking!",
        `₹${booking.pricing.total} • ${booking.services[0].name}`,
        {
          type: "new_booking",
          bookingId: booking._id.toString(),
          pincode,
          amount: booking.pricing.total,
          service: booking.services[0]?.name || "Car Wash",
          scheduledTime: booking.scheduledTime,
          scheduledDate: booking.scheduledDate,
          address: booking.serviceLocation.address,
        },
        { sound: true }
      );
    }

    // === 10. NOTIFY CUSTOMER ===
    if (customer.fcmToken) {
      await sendPushNotification(
        customer.fcmToken,
        "Booking Created!",
        `Scheduled for ${scheduledDate} at ${scheduledTime}`,
        { type: "new_booking", bookingId: booking._id }
      );
    }

    res.status(201).json({
      message: "Booking created successfully",
      booking,
    });
  } catch (error) {
    console.error("Create Booking Error:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

/**
 * CONFIRM BOOKING – Assign Partner + Update Partner fields
 */
exports.confirmBooking = async (req, res) => {
  console.log("test 1 in confirmBooking: ", req.body);
  try {
    console.log("test 2 in confirmBooking: ");
    console.log("confirmBooking called:- ", req.params, req.user, req.body);
    const { bookingId } = req.params;
    const { userId } = req.user;
    const { partnerLiveLocation } = req.body;
    console.log("test 3 in confirmBooking: ");

    const partner = await Partner.findById(userId).select(
      "businessModel branch"
    );
    if (!partner) return res.status(404).json({ message: "Partner not found" });

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.status !== "pending") {
      return res.status(400).json({ message: "Booking already processed" });
    }

    // ────── UPDATE BOOKING ──────
    booking.status = "confirmed";
    booking.partner = userId;

    // Set branch only if partner is Franchise-based
    if (partner.businessModel === "Franchise" && partner.branch) {
      booking.branch = partner.branch;
    }

    if (partnerLiveLocation) {
      booking.partnerLiveLocation = {
        coordinates: [
          partnerLiveLocation.longitude,
          partnerLiveLocation.latitude,
        ],
        updatedAt: new Date(),
      };
    }

    // ────── UPDATE PARTNER ──────
    partner.currentBookingId = booking._id; // <-- NEW
    partner.isAvailable = false; // <-- NEW

    // Save both in parallel (faster + atomic feel)
    await Promise.all([booking.save(), partner.save()]);

    // ────── REAL-TIME & NOTIFICATIONS ──────
    global.io?.to(`booking:${bookingId}`).emit("bookingConfirmed", booking);

    const customer = await User.findById(booking.customer).select("fcmToken");
    // if (customer?.fcmToken) {
    //   await sendNotification({
    //     type: "fcm",
    //     to: customer.fcmToken,
    //     title: "Partner Assigned",
    //     body: `${partner.name} is on the way!`,
    //   });
    // }

    return res.json(booking);
  } catch (error) {
    console.error("Confirm Booking Error:", error);
    return res.status(500).json({ message: "Failed to confirm booking" });
  }
};

/**
 * UPDATE STATUS – Live Tracking + Free partner on completion
 */
exports.updateBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, partnerLiveLocation } = req.body;
    const { userId } = req.user;

    const partner = await Partner.findById(userId);
    if (!partner) return res.status(404).json({ message: "Partner not found" });

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.partner?.toString() !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // ────── FINAL STATUS → FREE PARTNER ──────
    if (["completed", "cancelled"].includes(status)) {
      if (partner.currentBookingId?.toString() === bookingId) {
        partner.currentBookingId = null; // <-- CLEAR
        partner.isAvailable = true; // <-- MAKE AVAILABLE
      }
    }

    // ────── UPDATE BOOKING ──────
    booking.status = status;
    if (partnerLiveLocation) {
      booking.partnerLiveLocation = {
        coordinates: [
          partnerLiveLocation.longitude,
          partnerLiveLocation.latitude,
        ],
        updatedAt: new Date(),
      };
    }

    await Promise.all([booking.save(), partner.save()]);

    // ────── LIVE TRACKING ──────
    global.io?.to(`booking:${bookingId}`).emit("liveTracking", booking);

    return res.json(booking);
  } catch (error) {
    console.error("Update Status Error:", error);
    return res.status(500).json({ message: "Failed to update status" });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { bookingId, otp } = req.body;

    if (!bookingId || !otp) {
      return res.status(400).json({ error: "bookingId and otp are required" });
    }

    if (otp.length !== 4 || !/^\d+$/.test(otp)) {
      return res.status(400).json({ error: "OTP must be 4 digits" });
    }

    // Find booking with OTP
    const booking = await Booking.findById(bookingId).select("otp status");

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (!booking.otp) {
      return res.status(400).json({ error: "OTP already verified or not set" });
    }

    if (booking.otp !== otp) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // OTP IS CORRECT → REMOVE OTP
    booking.otp = undefined;
    booking.status = "confirmed"; // Optional: mark as confirmed
    await booking.save();

    res.status(200).json({
      message: "OTP verified successfully",
      booking: {
        _id: booking._id,
        status: booking.status,
      },
    });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

// controllers/bookingController.js
exports.getBookings = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "",
      franchiseId,
      customerId,
      partnerId,
    } = req.query;
    console.log("test in backend booking")

    const { role, userId } = req.user;

    // Convert to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    // Build dynamic query
    let query = {};

    // Status filter
    if (status && status !== "all" && status !== "") {
      query.status = status;
    }

    // Direct ID filters
    if (customerId) query.customer = customerId;
    if (partnerId) query.partner = partnerId;
    if (franchiseId) query.franchise = franchiseId;

    // Role-based access control
    if (role === "customer") query.customer = userId;
    if (role === "partner") query.partner = userId;
    if (role === "franchise" && franchiseId) query.franchise = franchiseId;

    // Search across multiple fields
    let searchQuery = {};
    if (search) {
      const searchRegex = { $regex: search, $options: "i" };
      searchQuery = {
        $or: [
          { "customer.name": searchRegex },
          { "customer.phone": searchRegex },
          { "partner.name": searchRegex },
          { "partner.phone": searchRegex },
          { bookingId: searchRegex },
          { "services.serviceId.name": searchRegex },
        ],
      };
    }

    // Combine filters
    const finalQuery = { ...query, ...searchQuery };

    // Execute with pagination
    const bookings = await Booking.find(finalQuery)
      .populate("customer branch partner vehicle services.serviceId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    // Get total count for pagination
    const total = await Booking.countDocuments(finalQuery);

    return res.json({
      bookings,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Get Bookings Error:", error);
    return res.status(500).json({ message: "Failed to fetch bookings" });
  }
};

// ────── GET ALL BOOKINGS BY USER ID (admin/franchise) ──────
exports.getAllBookingsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const bookings = await Booking.find({ customer: userId })
      .populate("customer branch partner vehicle services.serviceId")
      .sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    console.error("Get User Bookings Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

// ────── GET MY BOOKINGS (customer) ──────
exports.getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ customer: req.user.userId })
      .populate("customer branch partner vehicle services.serviceId")
      .sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    console.error("Get My Bookings Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

// ────── CANCEL BOOKING (10 min rule for customer) ──────
exports.cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const user = req.user;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    // Already cancelled or completed?
    if (["cancelled", "completed"].includes(booking.status)) {
      return res.status(400).json({ error: "Booking already processed" });
    }

    // Only customer who owns it OR admin/franchise can cancel
    const isOwner = booking.customer.toString() === user.userId.toString();
    const isAdminOrFranchise = ["admin", "franchise"].includes(user.role);

    if (!isOwner && !isAdminOrFranchise) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // 10‑minute rule for customer
    if (isOwner) {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      if (new Date(booking.createdAt) < tenMinutesAgo) {
        return res
          .status(400)
          .json({ error: "Cancellation window expired (10 min)" });
      }
    }

    // Update status
    booking.status = "cancelled";
    await booking.save();

    // Free partner if assigned
    if (booking.partner) {
      await Partner.findByIdAndUpdate(booking.partner, {
        currentBookingId: null,
        isAvailable: true,
      });
    }

    // Notify customer
    const customer = await User.findById(booking.customer).select("fcmToken");
    // if (customer?.fcmToken) {
    //   await sendNotification({
    //     type: "fcm",
    //     to: customer.fcmToken,
    //     title: "Booking Cancelled",
    //     body: "Your booking has been cancelled.",
    //   });
    // }

    res.json({ message: "Booking cancelled", booking });
  } catch (error) {
    console.error("Cancel Booking Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/**
 * GET SINGLE BOOKING
 */
exports.getBookingById = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId).populate(
      "customer branch partner vehicle services.serviceId"
    );

    if (!booking) return res.status(404).json({ message: "Booking not found" });

    return res.json(booking);
  } catch (error) {
    console.error("Get Booking Error:", error);
    return res.status(500).json({ message: "Failed to fetch booking" });
  }
};

// Helper: Extract 6-digit pincode
const extractPincode = (address) => {
  const match = address.match(/\b\d{6}\b/);
  return match ? match[0] : null;
};
