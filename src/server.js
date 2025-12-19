const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const partnerSocket = require('./socket/partner')
const customerSocket = require('./socket/customer')

const port = process.env.PORT || 5000;

connectDB();

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      process.env.SOCKET_IO_ORIGIN,
      'http://localhost:8081',
      'exp://*',
      'https://*.expo.dev',
      '*'
    ],
    credentials: true
  }
});

// const io = new Server(server, {
//   cors: {
//     origin: (origin, callback) => {
//       // Allow Expo, localhost, and your Render domain
//       if (
//         !origin ||
//         origin.startsWith('exp://') ||
//         origin.startsWith('http://localhost') ||
//         origin.startsWith('http://localhost:8081') ||
//         origin.startsWith('https://mwg-backend.onrender.com') ||
//         origin.includes('expo.dev')
//       ) {
//         callback(null, true);
//       } else {
//         callback(new Error('Not allowed by CORS'));
//       }
//     },
//     methods: ["GET", "POST"],
//     credentials: true
//   }
// });

// Attach io to every request
app.set('io', io);

// Initialize partner socket logic
const partnerIO = io.of('/partner');
partnerSocket(partnerIO);

// Initialize customer socket logic
const customerIO = io.of('/customer');
customerSocket(customerIO);

server.listen(port, () => console.log(`Server running on port ${port}`));

global.io = io;

// // Handle unhandled promise rejections.
// process.on('unhandledRejection', (err, promise) => {
//   console.log(`Error: ${err.message}`);
//   server.close(() => process.exit(1));
// });
// // Handle uncaught exceptions
// process.on('uncaughtException', (err) => {
//   console.log(`Error: ${err.message}`);
//   server.close(() => process.exit(1));
// });
// // Handle SIGTERM
// process.on('SIGTERM', () => {
//   console.log('SIGTERM received, shutting down gracefully');
//   server.close(() => {
//     console.log('Process terminated');
//   });
// });