// utils/sendNotification.js
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// Import models once at the top
const Partner = require('../models/Partner');
const User = require('../models/User');
const Franchise = require('../models/Franchise');

// Firebase Admin init
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin initialized');
  } catch (error) {
    console.error('Firebase Admin init failed:', error.message);
  }
}

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendNotification = async ({
  type = 'fcm',
  to,
  title,
  body,
  data = {},
  priority = 'high',
  franchiseId = null,
}) => {
  try {
    switch (type) {
      case 'fcm': {
        // Normalize tokens
        let tokens = [];
        if (typeof to === 'string') {
          if (to.trim()) tokens = [to.trim()];
        } else if (Array.isArray(to)) {
          tokens = to.filter(t => typeof t === 'string' && t.trim());
        }

        if (tokens.length === 0) {
          console.log('No valid FCM tokens → skipping');
          return;
        }

        const message = {
          tokens,
          notification: { title, body },
          data: {
            ...data,
            timestamp: Date.now().toString(),
          },
          android: {
            priority: priority === 'high' ? 'high' : 'normal',
            notification: {
              sound: 'default',
              channelId: 'booking',
              clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
                'content-available': 1,
              },
            },
          },
        };

        const response = await admin.messaging().sendMulticast(message);

        console.log(`FCM → ${response.successCount}/${tokens.length} sent`);

        // Clean invalid tokens
        if (response.failureCount > 0) {
          const invalidTokens = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const token = tokens[idx];
              const code = resp.error?.code;
              if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)) {
                invalidTokens.push(token);
              }
            }
          });

          if (invalidTokens.length > 0) {
            await Promise.all([
              Partner.updateMany({ fcmToken: { $in: invalidTokens } }, { $unset: { fcmToken: 1 } }),
              User.updateMany({ fcmToken: { $in: invalidTokens } }, { $unset: { fcmToken: 1 } }),
            ]);
            console.log(`Cleaned ${invalidTokens.length} invalid FCM tokens`);
          }
        }
        break;
      }

      case 'email':
        if (!to || !franchiseId) return;
        const franchise = await Franchise.findById(franchiseId);
        if (!franchise?.email) return;

        await transporter.sendMail({
          from: `"CarWash Pro" <${process.env.SMTP_USER}>`,
          to: franchise.email,
          subject: title,
          html: `<h2>${title}</h2><p>${body}</p><small>Booking ID: ${data.bookingId}</small>`,
        });
        break;

      case 'socket':
        if (global.io && to) {
          global.io.to(to).emit('notification', { title, body, data });
        }
        break;

      default:
        console.warn(`Unsupported notification type: ${type}`);
    }
  } catch (error) {
    console.error(`[NOTIFICATION ERROR] Type: ${type}`, error.message);
    // Don't throw — never crash booking flow
  }
};

module.exports = { sendNotification };