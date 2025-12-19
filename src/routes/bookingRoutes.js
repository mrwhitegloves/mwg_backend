const express = require('express');
const { createBooking, confirmBooking, updateBookingStatus, getBookings, getBookingById, getAllBookingsByUserId, getMyBookings, cancelBooking, verifyOTP } = require('../controllers/bookingController');
const { auth, roleCheck, authForDashboard, partnerAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/', auth, createBooking);
router.post('/verify-otp', auth, verifyOTP);
router.get('/', authForDashboard, getBookings);
router.get('/my', auth, getMyBookings);
router.put('/:bookingId/confirm', partnerAuth, roleCheck(['partner']), confirmBooking);
router.put('/:bookingId/status', auth, roleCheck(['partner']), updateBookingStatus);
router.get('/user/:userId', auth, roleCheck(['admin', 'franchise']), getAllBookingsByUserId);
router.patch('/:bookingId/cancel', auth, cancelBooking);
router.get('/:bookingId', auth, getBookingById);

module.exports = router;