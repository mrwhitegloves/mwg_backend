const AdminUser = require('../models/AdminUser');
const jwt = require('jsonwebtoken');

// POST /api/admin/auth/login - Login with email and password
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await AdminUser.findOne({ email }).select('+password');
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const payload = {
      userId: user._id,
      role: user.role,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Set HTTP‑only cookie – **NAME = adminToken**
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Update lastLogin
    user.token = token;
    user.lastLogin = new Date();
    await user.save();

    res.json({
      message: 'Login successful',
      token,
      user: { _id: user._id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
};

// GET /api/admin/auth/me - Get authenticated user details
exports.getLoginUser = async (req, res) => {
  try {
    const user = await AdminUser.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Get Me Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/admin/auth/logout - Clear cookie and logout
exports.logout = async (req, res) => {
  const token =
      req.cookies?.adminToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(400).json({ message: "No token provided" });
    }

    // ✅ Find the admin by token and remove it
    const admin = await AdminUser.findOne({ token });
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // ✅ Remove token from DB
    admin.token = null;
    await admin.save();

    // ✅ Clear the cookie from client browser
    res.clearCookie("adminToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
  res.json({ message: 'Logout successful' });
};

// POST /api/admin/auth/create - Create new admin user (super admin only)
exports.createUser = async (req, res) => {
  const { email, password, name, role } = req.body;

  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'Email, password, name, and role are required' });
  }

  const validRoles = ['admin', 'franchiseAdmin', 'franchiseEmployee'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // if (role !== 'admin' && !franchiseId) {
  //   return res.status(400).json({ error: 'franchiseId required for non-admin roles' });
  // }

  try {
    const existingUser = await AdminUser.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const newUser = new AdminUser({
      email,
      password,
      name,
      role,
      // franchiseId: role !== 'admin' ? franchiseId : undefined,
    });

    await newUser.save();
    res.status(201).json({ message: 'Admin user created', user: { _id: newUser._id, email, name, role } });
  } catch (error) {
    console.error('Create Admin User Error:', error);
    res.status(500).json({ error: 'Server error during user creation' });
  }
};

// GET /api/admin/franchise-admins - Get list of active franchise admins
exports.getFranchiseAdmins = async (req, res) => {
  try {
    const admins = await AdminUser.find({ role: 'franchiseAdmin', isActive: true })
      .select('_id name email')
      .sort({ name: 1 });

    res.json({ admins });
  } catch (error) {
    console.error('Get Franchise Admins Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};