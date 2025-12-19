// apps/backend/controllers/fcmController.js
const User = require('../models/User');
const Franchise = require('../models/Franchise');
const Partner = require('../models/Partner');

/**
 * Update FCM Token for Authenticated User (Customer / Franchise Admin)
 */
exports.updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const { userId, role } = req.user; // From JWT auth middleware

    if (!fcmToken || typeof fcmToken !== 'string') {
      return res.status(400).json({ error: 'Valid fcmToken is required' });
    }

    let updatedDoc;

    if (role === 'customer') {
      updatedDoc = await User.findByIdAndUpdate(
        userId,
        { fcmToken },
        { new: true, runValidators: true }
      ).select('name phone fcmToken');
    } 
    else if (role === 'franchise') {
      updatedDoc = await Franchise.findByIdAndUpdate(
        userId,
        { fcmToken },
        { new: true, runValidators: true }
      ).select('name email phone fcmToken');
    } 
    else if (role === 'partner') {
      updatedDoc = await Partner.findByIdAndUpdate(
        userId,
        { fcmToken },
        { new: true, runValidators: true }
      ).select('name email phone fcmToken');
    } 
    else {
      return res.status(403).json({ error: 'Invalid role for FCM update' });
    }

    if (!updatedDoc) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      message: 'FCM token updated successfully',
      user: updatedDoc,
    });

  } catch (error) {
    console.error('Update FCM Token Error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
};