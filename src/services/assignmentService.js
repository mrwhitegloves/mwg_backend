const User = require('../models/User');
const Booking = require('../models/Booking');

// Simple nearest partner logic (use geolocation distance calculation)
const assignToNearestPartner = async (booking) => {
  const partners = await User.find({ role: 'partner', /* availability: true */ });
  // Calculate distances (pseudo, use haversine formula in production)
  const nearest = partners[0]; // Placeholder
  booking.partnerId = nearest._id;
  booking.status = 'assigned';
  await booking.save();
  global.io.to(`partner:${nearest._id}`).emit('booking:offer', booking);
};

module.exports = { assignToNearestPartner };