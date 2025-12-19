// controllers/couponController.js
const Coupon = require('../models/Coupon');
const Booking = require('../models/Booking'); // Assuming you have this for apply logic

exports.createCoupon = async (req, res) => {
  try {
    const {
      name, type, pincodes = [], code, limitPerUser = 1,
      startDate, endDate, discountType, discountValue,
      maxDiscount = 0, minAmount = 0, status = 'Active'
    } = req.body;

    if (type === 'Franchise-wise' && pincodes.length === 0) {
      return res.status(400).json({ error: 'Pincodes required for Franchise-wise coupons' });
    }

    const newCoupon = new Coupon({
      name, type, pincodes, code: code.toUpperCase(), limitPerUser,
      startDate: new Date(startDate), endDate: new Date(endDate),
      discountType, discountValue, maxDiscount, minAmount, status,
      createdBy: req.user.role === 'franchise' ? 'FRANCHISE' : 'ADMIN'
    });

    await newCoupon.save();
    res.status(201).json({ message: 'Coupon created successfully', coupon: newCoupon });
  } catch (error) {
    console.error('Create coupon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getAllCoupons = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const query = search ? { name: { $regex: search, $options: 'i' } } : {};
    const coupons = await Coupon.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Coupon.countDocuments(query);
    res.json({ coupons, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// controllers/couponController.js
exports.getCouponById = async (req, res) => {
  try {
    const { id } = req.params;

    // SAFETY CHECK — prevent "undefined" error
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ error: 'Invalid coupon ID' });
    }

    const coupon = await Coupon.findById(id);

    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    res.json({
      message: 'Coupon fetched successfully',
      coupon
    });
  } catch (error) {
    console.error('Get coupon by ID error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid coupon ID format' });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getCouponsByPincodeAndPrice = async (req, res) => {
  try {
    const { pincode, price } = req.query;
    if (!pincode || !price) return res.status(400).json({ error: 'Pincode and price required' });

    const now = new Date();
    const coupons = await Coupon.find({
      $or: [{ type: 'All' }, { type: 'Franchise-wise', pincodes: pincode }],
      startDate: { $lte: now },
      endDate: { $gte: now },
      minAmount: { $lte: Number(price) },
      status: 'Active'
    }).sort({ discountValue: -1 }); // Highest discount first

    res.json({ coupons });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.applyCoupon = async (req, res) => {
  try {
    const { code, price, pincode } = req.body;
    const userId = req.user.userId;

    if (!code || !price || !pincode) {
      return res.status(400).json({ error: 'Please try again' });
    }

    const coupon = await Coupon.findOne({ code: code.toUpperCase(), status: 'Active' });
    if (!coupon) return res.status(400).json({ error: 'Invalid coupon' });

    const now = new Date();
    if (now < coupon.startDate || now > coupon.endDate) {
      return res.status(400).json({ error: 'Coupon expired' });
    }

    if (price < coupon.minAmount) {
      return res.status(400).json({ error: 'Minimum amount not met' });
    }

    if (coupon.type === 'Franchise-wise') {
      if (!coupon.pincodes.includes(pincode)) {
        return res.status(400).json({ error: 'Coupon not valid for your location' });
      }
    }
    // If type is 'All' → no pincode check needed

    // Check usage limit
    const userUsage = coupon.usedBy.find(u => u.userId.toString() === userId.toString());
    if (userUsage && userUsage.usedCount >= coupon.limitPerUser) {
      return res.status(400).json({ error: 'Coupon already used' });
    }

    let discount = 0;
    if (coupon.discountType === 'Percentage') {
      discount = Math.min((price * coupon.discountValue / 100), coupon.maxDiscount);
    } else {
      discount = coupon.discountValue;
    }

    const newPrice = price - discount;

    // Update usage
    // if (userUsage) {
    //   console.log("Incrementing user usage count");
    //   userUsage.usedCount += 1;
    // } else {
    //   console.log("Adding new user usage record");
    //   coupon.usedBy.push({ userId, usedCount: 1 });
    // }
    await coupon.save();

    res.json({ message: 'Coupon applied', discount, newPrice });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    res.json({ message: 'Coupon updated', coupon });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    res.json({ message: 'Coupon deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};