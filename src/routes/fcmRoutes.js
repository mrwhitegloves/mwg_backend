const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/authMiddleware'); // JWT middleware
const { updateFcmToken } = require('../controllers/fcmController');

// Protected route – any logged-in user (customer or franchise)
router.put('/me/fcm', auth, updateFcmToken);

module.exports = router;