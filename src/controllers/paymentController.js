// controllers/paymentController.js
const Razorpay = require('razorpay');
const OnlinePayment = require('../models/OnlinePayment');
const crypto = require('crypto');
const Booking = require('../models/Booking');
const PaymentSplit = require('../models/PaymentSplit');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const getBookingTotal = async (bookingId) => {
  const booking = await Booking.findById(bookingId).select('pricing.total');
  return booking.pricing.total;
};

// 1. CREATE ORDER (before booking)
exports.createOrder = async (req, res) => {
  try {
    const { amount, userId } = req.body;

    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: 'INR',
      receipt: `pay_${Date.now()}`,
    });
    console.log("order: ", order)

    const payment = new OnlinePayment({
      user: userId,
      amount,
      orderId: order.id,
      status: 'created',
    });
    await payment.save();

    res.json({ orderId: order.id, payment: { _id: payment._id } });
  } catch (err) {
    console.log("error in createOrder: ",err)
    res.status(500).json({ error: err.message });
  }
};

// 2. VERIFY PAYMENT
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId } = req.body;
    console.log("razorpay_order_id",razorpay_order_id)
    console.log("razorpay_payment_id",razorpay_payment_id)
    console.log("razorpay_signature",razorpay_signature)
    console.log("paymentId",paymentId)
    console.log("test verifyPayment 1")

    const sign = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
      console.log("test verifyPayment 2")

    if (sign !== razorpay_signature) {
      console.log("test verifyPayment 3")
      return res.status(400).json({ error: 'Invalid signature' });
    }
    console.log("test verifyPayment 4")

    await OnlinePayment.findByIdAndUpdate(paymentId, {
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      status: 'paid',
      paidAt: new Date(),
    });
    console.log("test verifyPayment 5")

    res.json({ success: true });
  } catch (err) {
    console.log("error in verifyPayment: ", verifyPayment)
    res.status(500).json({ error: err.message });
  }
};

// 3. MARK PAYMENT FAILED (booking failed)
exports.markPaymentFailed = async (req, res) => {
  try {
    const { paymentId, reason } = req.body;
    await OnlinePayment.findByIdAndUpdate(paymentId, {
      status: 'failed',
      refundReason: reason,
      refundPending: true,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// controllers/paymentController.js
exports.collectCash = async (req, res) => {
  try {
    const { bookingId, amount } = req.body;
    const partnerId = req.user.userId;

    const split = await PaymentSplit.findOne({ booking: bookingId });
    if (!split) return res.status(404).json({ error: 'Payment split not found' });
    if (split.status === 'completed') return res.status(400).json({ error: 'Already completed' });

    const total = await getBookingTotal(bookingId); // implement or pass
    const remaining = total - split.onlineAmount;

    if (amount > remaining) {
      return res.status(400).json({ error: 'Amount exceeds remaining' });
    }

    split.cashAmount = amount;
    split.cashCollectedAt = new Date();
    split.collectedBy = partnerId;
    split.status = (split.onlineAmount + amount >= total) ? 'completed' : 'partial';

    await split.save();
    res.json({ success: true, split });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// NEW: Generate UPI QR Code
exports.createUpiQr = async (req, res) => {
  try {
    const { amount, bookingId, customerId } = req.body;

    const qr = await razorpay.qrCode.create({
      type: "upi_qr",
      name: `Mr White Gloves - Booking #${bookingId}`,
      usage: "single_use",
      fixed_amount: true,
      payment_amount: amount * 100, // in paise
      description: `Car wash service payment for booking ${bookingId}`,
      // customer_id: customerId || null,
      close_by: Math.floor(Date.now() / 1000) + 1800, // 30 minutes expiry
      notes: {
        bookingId,
        partnerId: req.user.userId,
      }
    });

    res.json({
      success: true,
      data: qr,
      qrCodeId: qr.id,
      imageUrl: qr.image_url, // Direct image link!
      amount: amount,
    });
  } catch (err) {
    console.error("QR Creation failed:", err);
    res.status(500).json({ error: "Failed to generate QR" });
  }
};

// GENERATE QR FOR PARTNER (New)
exports.generateQRCode = async (req, res) => {
  try {
    const { amount, bookingId } = req.body;
    const partnerId = req.user.userId;

    // Verify booking
    const booking = await Booking.findOne({ _id: bookingId, partner: partnerId });
    if (!booking || booking.pricing.total !== amount) {
      return res.status(400).json({ error: 'Invalid booking or amount' });
    }

    // Create QR via Razorpay API
    const qrResponse = await fetch('https://api.razorpay.com/v1/qrcodes', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'upi', // UPI QR
        amount: amount * 100, // paise
        currency: 'INR',
        description: `Payment for Booking ${booking.bookingId}`,
        account_number: process.env.RAZORPAY_ACCOUNT_NUMBER, // Your merchant account.
        ifsc_code: process.env.RAZORPAY_IFSC_CODE,
        name: 'Mr White Gloves', // Business name
        short_code: 'mwg', // Custom code
        image_link: 'https://yourdomain.com/qr-logo.png', // Optional logo
      })
    });

    const qrData = await qrResponse.json();
    if (qrData.error) {
      return res.status(400).json({ error: qrData.error.description });
    }

    // Save QR to DB (optional)
    await OnlinePayment.findOneAndUpdate(
      { booking: bookingId },
      { qrCodeId: qrData.id, qrUrl: qrData.short_url },
      { upsert: true, new: true }
    );

    res.json({
      qrCode: qrData.id,
      qrUrl: qrData.short_url,
      qrImage: qrData.qr_code, // Base64 image
      amount,
      message: 'Show this QR to customer'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};