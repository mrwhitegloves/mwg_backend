// socket/customer.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Booking = require('../models/Booking');

module.exports = (io) => {
  io.use(async (socket, next) => {
    try {
        console.log("test in customer")
      const token = socket.handshake.auth.access_token;
      if (!token) return next(new Error('No token'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const customer = await User.findById(payload.userId).select('name phone');
      if (!customer) return next(new Error('Customer not found-s'));

      socket.user = { id: payload.userId, name: customer.name };
      next();
    } catch (err) {
      next(new Error('Auth failed'));
    }
  });

  io.on('connection', (socket) => {
    const customerId = socket.user.id;
    console.log(`Customer ${customerId} connected`);

    // Join booking room when needed
    socket.on('joinBooking', (bookingId) => {
      socket.join(`booking:${bookingId}`);
      console.log(`Customer joined booking:${bookingId}`);
    });

    socket.on('disconnect', () => {
      console.log(`Customer ${customerId} disconnected`);
    });
  });

  // Global: Emit to customer
  global.emitToCustomer = (customerId, event, data) => {
    io.to(`user:${customerId}`).emit(event, data);
  };

  // Global: Emit to booking room
  global.emitToBooking = (bookingId, event, data) => {
    io.to(`booking:${bookingId}`).emit(event, data);
  };
};
