// src/socket/partner.js
const jwt = require('jsonwebtoken');
const Partner = require('../models/Partner');
const Booking = require('../models/Booking');

const activePartners = new Map(); 
// partnerId → { socketId, partnerId, servicePincodes: Set<string> }

const bookingOffers = new Map(); // bookingId → { offeredTo: Set<string>, timeout }

module.exports = (io) => {
  // ==================== AUTH MIDDLEWARE ====================
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.access_token;
      if (!token) return next(new Error('Authentication required'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const partner = await Partner.findById(payload.userId)
        .select('name serviceArea.pincodes')
        .lean();

      if (!partner) return next(new Error('Partner not found'));

      socket.user = {
        id: payload.userId,
        name: partner.name || 'Partner',
        pincodes: new Set(partner.serviceArea?.pincodes?.map(p => p.toString()) || []),
      };

      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  // ==================== CONNECTION ====================
  io.on('connection', (socket) => {
    const partnerId = socket.user.id;
    const pincodesSet = socket.user.pincodes;

    console.log(`Partner ${partnerId} connected (covers ${pincodesSet.size} pincodes)`);

    // === GO ONLINE ===
    socket.on('goOnline', ({ latitude, longitude } = {}) => {
      console.log("partnerId:- ", partnerId);
      console.log("socket.id:- ", socket.id);
      console.log("pincodesSet:- ", pincodesSet);
      console.log("latitude:- ", latitude);
      activePartners.set(partnerId, {
        socketId: socket.id,
        partnerId,
        servicePincodes: pincodesSet,
        location: latitude && longitude ? { latitude, longitude } : null,
      });

      socket.join(`partner:${partnerId}`);
      console.log(`Partner ${partnerId} is ONLINE`);
      logActivePartners();
    });

    const logActivePartners = () => {
  console.log(`\nActive Partners Online: ${activePartners.size}\n` + '='.repeat(50));
  
  if (activePartners.size === 0) {
    console.log("No partners online right now.");
    return;
  }

  Array.from(activePartners.entries()).forEach(([partnerId, data]) => {
    console.log(`Partner ID: ${partnerId}`);
    console.log(`   Name      : ${data.partnerName || 'Unknown'}`);
    console.log(`   Socket ID : ${data.socketId}`);
    console.log(`   Pincodes  : ${Array.from(data.servicePincodes).join(', ')}`);
    console.log(`   Location  :`, data.location || 'Not shared');
    console.log('   ---');
  });
  console.log('='.repeat(50) + '\n');
};

    // === GO OFFLINE ===
    socket.on('goOffline', () => {
      activePartners.delete(partnerId);
      socket.leave(`partner:${partnerId}`);
      console.log(`Partner ${partnerId} is OFFLINE`);
    });

    // === ACCEPT BOOKING ===
    socket.on('acceptBooking', async ({ bookingId }) => {
      const offer = bookingOffers.get(bookingId);
      if (!offer || offer.accepted) return;

      offer.accepted = true;
      clearTimeout(offer.timeout);

      socket.join(`booking:${bookingId}`);

      io.to(`booking:${bookingId}`).emit('bookingAccepted', {
        partnerId,
        partnerName: socket.user.name,
        message: 'Your partner is on the way!',
      });

      // Notify others that they lost the booking
      offer.offeredTo.forEach(id => {
        if (id !== partnerId) {
          io.to(`partner:${id}`).emit('bookingCancelled', { bookingId });
        }
      });

      console.log(`Booking ${bookingId} accepted by ${partnerId}`);
    });

    // === DECLINE BOOKING ===
    socket.on('declineBooking', ({ bookingId }) => {
      const offer = bookingOffers.get(bookingId);
      if (offer) {
        offer.offeredTo.delete(partnerId);
      }
    });

    // === UPDATE BOOKING STATUS ===
    socket.on('updateBookingStatus', async ({ bookingId, status }) => {
      const valid = ['enroute', 'arrived', 'in-progress', 'completed', 'cancelled'];
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

  // ==================== GLOBAL: PUSH NEW BOOKING (BY PINCODE) ====================
  global.pushNewBooking = async (booking) => {
    console.log("Pushing new booking to partners...", booking);
    const { _id, serviceLocation, services, pricing, scheduledTime, scheduledDate } = booking;
    // console.log("serviceLocation:- ", serviceLocation)
    // console.log("_id:- ", _id)
    // console.log("booking:- ", booking)
    const customerPincode = serviceLocation?.pincode?.toString();

    if (!customerPincode) {
      console.log("No pincode in booking → cannot push");
      return;
    }

    // Find all active partners who serve this pincode.
    const eligiblePartners = Array.from(activePartners.values())
      .filter(p => p.servicePincodes.has(customerPincode));

    if (eligiblePartners.length === 0) {
      console.log(`No active partner serves pincode ${customerPincode}`);
      return;
    }
    console.log("eligiblePartners:- ", eligiblePartners)

    const bookingData = {
      bookingId: _id.toString(),
      address: serviceLocation.address,
      pincode: customerPincode,
      service: services[0]?.name || 'Car Wash',
      total: pricing.total,
      scheduledDate,
      scheduledTime,
      playRingtone: true,
    };

    const offeredTo = new Set(eligiblePartners.map(p => p.partnerId));
    console.log("offeredTo:- ", offeredTo)

    // 60-second auto-expire
    const timeout = setTimeout(async () => {
      if (!bookingOffers.get(_id.toString())?.accepted) {
        await Booking.findByIdAndUpdate(_id, { status: 'expired' });
        io.to(`booking:${_id}`).emit('bookingExpired');
        bookingOffers.delete(_id.toString());
      }
    }, 600000);

    bookingOffers.set(_id.toString(), { offeredTo, timeout, accepted: false });

    // Emit to all eligible partners
    eligiblePartners.forEach(p => {
      io.to(p.socketId).emit('newBooking', bookingData);
    });

    console.log(`Booking ${_id} pushed to ${eligiblePartners.length} partners (pincode: ${customerPincode})`);
  };
};