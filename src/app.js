const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

dotenv.config();

const app = express();
// app.use(cors({ origin: [
//   process.env.SOCKET_IO_ORIGIN, 
//   'https://twin-dash-design.vercel.app', 
//   'http://localhost:8080', 
//   'http://192.168.29.36:5000',
//   'http://localhost:8081', // Local development
//   'exp://192.168.29.36:8081', // Expo Go
//   'exp://172.18.115.55:8081',
//   'exp://*', // All Expo development
//   'https://*.expo.dev', // Expo hosting
//   '*' // Production APK (change to your domain)
// ], credentials: true }));

const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Routes
app.use('/api/auth', require('./routes/userRoutes'));
app.use('/api/services', require('./routes/serviceRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/admin/auth', require('./routes/adminUserRoutes'));
app.use('/api/admin/franchise', require('./routes/franchiseRoutes'));
app.use('/api/admin/service', require('./routes/adminServiceRoutes'));
app.use('/api/admin/category', require('./routes/categoryRoutes'));
app.use('/api/partners', require('./routes/partnerRoutes'));
app.use('/api/fcm', require('./routes/fcmRoutes'));
app.use('/api/coupons', require('./routes/couponRoutes'));

// ———————————————————— ROOT & HEALTH ————————————————————
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to Mr White Gloves Backend API',
    health: '/health',
    time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  });
});

app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const uptimeString = formatUptime(uptime);

  res.status(200).json({
    status: 'ok',
    message: 'Mr White Gloves API is alive!',
    timestamp: new Date().toISOString(),
    uptime: uptimeString,
    serverTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  const secs = Math.floor(seconds % 60);
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

// Error handling
app.use((err, req, res, next) => {
  res.status(500).json({ message: err.message });
});

module.exports = app;