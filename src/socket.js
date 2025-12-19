// socket.js
const jwt = require('jsonwebtoken');
const Partner = require('./models/Partner');
const Booking = require('./models/Booking');

const activePartners = new Map(); // partnerId → { socketId, franchiseId }
const bookingOffers = new Map();  // bookingId → { timeout, offeredTo }

module.exports = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.access_token;
      if (!token) return next(new Error('No token'));
      console.log("token socket", token)

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      console.log("payload socket", payload)
      const partner = await Partner.findById(payload.userId).select('branch');
      console.log("partner socket", partner)
      if (!partner) return next(new Error('Partner not found'));

      socket.user = { id: payload.userId, franchiseId: partner.branch };
      next();
    } catch (err) {
      next(new Error('Auth failed'));
    }
  });

  io.on('connection', (socket) => {
    const partnerId = socket.user.id;
    console.log(`Partner ${partnerId} connected`);

    // === 1. GO ONLINE (NO COORDS) ===
    socket.on('goOnline', () => {
      activePartners.set(partnerId, {
        socketId: socket.id,
        franchiseId: socket.user.franchiseId,
        partnerId,
      });
      socket.join(`franchise:${socket.user.franchiseId}`);
      socket.join(`partner:${partnerId}`);
      console.log(`Partner ${partnerId} is ONLINE`);
    });

    // === 2. GO OFFLINE ===
    socket.on('goOffline', () => {
      activePartners.delete(partnerId);
      socket.leave(`franchise:${socket.user.franchiseId}`);
      socket.leave(`partner:${partnerId}`);
      console.log(`Partner ${partnerId} is OFFLINE`);
    });

    // === 3. ACCEPT BOOKING ===
    socket.on('acceptBooking', async ({ bookingId }) => {
      const offer = bookingOffers.get(bookingId);
      if (!offer || offer.accepted) return;

      offer.accepted = true;
      clearTimeout(offer.timeout);

      await Booking.findByIdAndUpdate(bookingId, {
        partner: partnerId,
        status: 'accepted',
        acceptedAt: new Date(),
      });

      io.to(`booking:${bookingId}`).emit('bookingAccepted', {
        partnerId,
        message: 'Partner is on the way!'
      });

      offer.offeredTo.forEach(id => {
        if (id !== partnerId) {
          io.to(`partner:${id}`).emit('bookingCancelled', { bookingId });
        }
      });

      console.log(`Booking ${bookingId} ACCEPTED by ${partnerId}`);
    });

    // === 4. DECLINE BOOKING ===
    socket.on('declineBooking', ({ bookingId }) => {
      const offer = bookingOffers.get(bookingId);
      if (offer) {
        offer.offeredTo = offer.offeredTo.filter(id => id !== partnerId);
      }
    });

    // === 5. UPDATE STATUS ===
    socket.on('updateBookingStatus', async ({ bookingId, status }) => {
      const valid = ['traveling', 'arrived', 'started', 'completed'];
      if (!valid.includes(status)) return;

      const update = { status };
      if (status === 'completed') update.completedAt = new Date();

      await Booking.findByIdAndUpdate(bookingId, update);

      io.to(`booking:${bookingId}`).emit('bookingStatusUpdate', { bookingId, status });
    });

    // === DISCONNECT ===
    socket.on('disconnect', () => {
      activePartners.delete(partnerId);
      console.log(`Partner ${partnerId} disconnected`);
    });
  });

  // === GLOBAL: PUSH NEW BOOKING (MVP – ALL PARTNERS IN FRANCHISE) ===
  global.pushNewBooking = async (booking) => {
    const { _id, branch, services, serviceLocation, scheduledTime, pricing } = booking;
    const franchiseId = branch.toString();

    // Get ALL active partners in this franchise
    const partnersInFranchise = Array.from(activePartners.values())
      .filter(p => p.franchiseId.toString() === franchiseId);

    if (partnersInFranchise.length === 0) {
      console.log(`No active partners in franchise ${franchiseId}`);
      return;
    }

    const bookingData = {
      bookingId: _id.toString(),
      address: serviceLocation.address,
      service: services[0]?.name || 'Service',
      total: pricing.total,
      scheduledTime,
      playRingtone: true,
    };

    const offeredTo = partnersInFranchise.map(p => p.partnerId);

    // 60-second expiry
    const timeout = setTimeout(async () => {
      if (!bookingOffers.get(_id)?.accepted) {
        await Booking.findByIdAndUpdate(_id, { status: 'expired' });
        io.to(`booking:${_id}`).emit('bookingExpired');
        bookingOffers.delete(_id);
      }
    }, 600000);

    bookingOffers.set(_id.toString(), { offeredTo, timeout, accepted: false });

    // PUSH TO ALL AT ONCE
    partnersInFranchise.forEach(p => {
      io.to(p.socketId).emit('newBooking', bookingData);
    });

    console.log(`New booking ${_id} pushed to ${partnersInFranchise.length} partners`);
  };
};
