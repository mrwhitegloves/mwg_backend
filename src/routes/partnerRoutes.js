// routes/partnerRoutes.js
const express = require('express');
const router = express.Router();
const { auth, adminCheck, authForDashboard, partnerAuth } = require('../middleware/authMiddleware');
const {
  createPartner, updatePartner, deletePartner,
  getAllPartners, getPartnerById,
  loginPartner,
  updatePartnerMe,
  getPartnerMe,
  getEarnings,
  getPartnerBookings,
  logoutPartner,
  getTodayBookings,
  getAllPartnerBookings,
  getPartnerDashboard,
  getMonthlyEarnings,
  getStatusHistory,
  getBookingDetails,
  startService,
  markArrived,
  verifyOtpAndStartService,
  collectPayment,
  updatePartnerImage,
  getAllPayments,
  updatePushToken
} = require('../controllers/partnerController');

router.post('/', authForDashboard, adminCheck, createPartner);
router.post('/login', loginPartner);
router.get('/', getAllPartners);
router.get('/me', partnerAuth, getPartnerMe);
router.patch('/me', partnerAuth, updatePartnerMe);
router.post('/me/update-push-token', partnerAuth, updatePushToken);
router.patch('/image-upload/me', partnerAuth, updatePartnerImage);
router.get('/me/earnings', partnerAuth, getEarnings);
router.get('/me/bookings', partnerAuth, getPartnerBookings);
router.get('/me/bookings/all', partnerAuth, getAllPartnerBookings);
router.get('/me/bookings/today', partnerAuth, getTodayBookings);
router.get('/me/dashboard', partnerAuth, getPartnerDashboard);
router.get('/me/earnings/monthly', partnerAuth, getMonthlyEarnings);
router.get('/me/status-history', partnerAuth, getStatusHistory);

router.get('/booking/:id', partnerAuth, getBookingDetails);
router.post('/booking/:id/start-service', partnerAuth, startService);
router.post('/booking/:id/mark-arrived', partnerAuth, markArrived);
router.post('/booking/:id/verify-otp', partnerAuth, verifyOtpAndStartService);
router.post('/booking/:bookingId/collect-payment', partnerAuth, collectPayment);

router.get('/payments', partnerAuth, getAllPayments);

router.get('/:id', getPartnerById);
router.put('/:id', auth, adminCheck, updatePartner);
router.delete('/:id', auth, adminCheck, deletePartner);
router.post('/logout', partnerAuth, logoutPartner);

module.exports = router;