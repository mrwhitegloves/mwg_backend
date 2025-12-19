// routes/couponRoutes.js
const express = require('express');
const router = express.Router();
const { auth, authForDashboard } = require('../middleware/authMiddleware');
const { createCoupon, getAllCoupons, updateCoupon, deleteCoupon, getCouponsByPincodeAndPrice, applyCoupon, getCouponById } = require('../controllers/couponController.js');

// Admin only routes
router.post('/', authForDashboard, createCoupon);
router.get('/', authForDashboard, getAllCoupons);

// Customer routes (no auth for get by pincode/price, but apply requires auth)
router.get('/available', auth, getCouponsByPincodeAndPrice);
router.post('/apply', auth, applyCoupon);

router.get('/:id', authForDashboard, getCouponById);
router.put('/:id', authForDashboard, updateCoupon);
router.delete('/:id', authForDashboard, deleteCoupon);


module.exports = router;