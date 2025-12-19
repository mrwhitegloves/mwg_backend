const express = require('express');
const { createOrder, verifyPayment, markPaymentFailed, collectCash, generateQRCode, createUpiQr } = require('../controllers/paymentController');
const { auth, partnerAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/create-order', createOrder);
router.post('/verify', verifyPayment);
router.post('/failed', markPaymentFailed);
router.post('/collect-cash', collectCash);
router.post('/create-upi-qr', partnerAuth, createUpiQr);
router.post('/generate-qr', partnerAuth, generateQRCode);

module.exports = router;