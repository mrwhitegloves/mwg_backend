const User = require('../models/User');
const Partner = require('../models/Partner');
const Admin = require('../models/AdminUser');

// Unified update for any user type
exports.updateProfile = async (req, res) => {
  try {
    const { userId, role } = req.user; // From JWT middleware
    const updateData = req.body;

    let Model;
    let user;

    // Dynamic model selection
    switch (role) {
      case 'customer':
        Model = User;
        break;
      case 'partner':
        Model = Partner;
        break;
      case 'admin':
        Model = Admin;
        break;
      default:
        return res.status(400).json({ error: 'Invalid user role' });
    }

    // Find user
    user = await Model.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Optional: Prevent sensitive field updates
    const blockedFields = ['password', 'role', '_id', 'createdAt', 'updatedAt'];
    blockedFields.forEach(field => delete updateData[field]);

    // Update with validation
    const updatedUser = await Model.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true, select: '-password' }
    );

    return res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Update Profile Error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
};