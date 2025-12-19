const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Customer app User model
const AdminUser = require('../models/AdminUser'); // Admin dashboard User model
const Partner = require('../models/Partner');

// Auth Middleware Function
const auth = async (req, res, next) => {
  try {
    // Step 1: Get token from Authorization header or cookie
    let token;
    const authHeader = req.headers.authorization;
    const isAdminRoute = req.originalUrl.startsWith('/api/admin/');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1]; // Extract token from "Bearer <token>"
    } else if (isAdminRoute && req.cookies?.adminToken) {
      token = req.cookies.adminToken; // Admin dashboard uses HTTP-only cookie
    }

    if (!token) {
      console.log("not token")
      return res.status(401).json({ error: 'Access denied: No token provided' });
    }

    // Step 2: Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Step 3: Determine user type based on route
    let user;
    if (isAdminRoute) {
      // Admin dashboard: Use AdminUser model
      user = await AdminUser.findById(decoded.userId).select('-password');
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Access denied: Invalid admin user' });
      }
      req.user = {
        userId: user._id,
        role: user.role,
        franchiseId: user.franchiseId,
        isAdminUser: true, // Flag to differentiate
      };
    } else {
      // Customer app: Use User model
      user = await User.findById(decoded.userId).select('-password');
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Access denied: Invalid user' });
      }
      req.user = {
        userId: user._id,
        role: user.role,
        isAdminUser: false,
      };
    }

    // Step 4: Proceed to route handler
    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Access denied: Invalid token' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access denied: Token expired' });
    }
    return res.status(500).json({ error: 'Server error during authentication' });
  }
};

// PartnerAuth Middleware Function
const partnerAuth = async (req, res, next) => {
  try {
    // Step 1: Get token from Authorization header or cookie
    let token;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1]; // Extract token from "Bearer <token>"
    }

    if (!token) {
      console.log("not token")
      return res.status(401).json({ error: 'Access denied: No token provided' });
    }

    // Step 2: Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Step 3: Determine user type based on route
    let user;
    if (authHeader) {
      // Customer app: Use User model
      user = await Partner.findById(decoded.userId).select('-password');
      if (!user || !user.active) {
        return res.status(401).json({ error: 'Access denied: Invalid user' });
      }
      req.user = {
        userId: user._id,
        role: user.role,
        isAdminUser: false,
      };
    }

    // Step 4: Proceed to route handler
    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Access denied: Invalid token' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access denied: Token expired' });
    }
    return res.status(500).json({ error: 'Server error during authentication' });
  }
};

// authForDashboard Middleware Function
const authForDashboard = async (req, res, next) => {
  try {
    // Step 1: Get token from Authorization header or cookie.
    let token = req.cookies?.adminToken;

    // Optional: also accept Authorization: Bearer <token>
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      console.log('No token provided');
      return res.status(401).json({ error: 'Access denied: No token provided' });
    }


    // Step 2: Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Step 3: Determine user type based on route
    let user;
      // Admin dashboard: Use AdminUser model
      user = await AdminUser.findById(decoded.userId).select('-password');
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Access denied: Invalid admin user' });
      }
      req.user = {
        userId: user._id,
        role: user.role,
        franchiseId: user.franchiseId,
        isAdminUser: true, // Flag to differentiate
      };

    // Step 4: Proceed to route handler
    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Access denied: Invalid token' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access denied: Token expired' });
    }
    return res.status(500).json({ error: 'Server error during authentication' });
  }
};

// middleware/roleCheck.js
const roleCheck = (allowedRoles) => {
  console.log(`Allowed Roles: ${allowedRoles}`);
  return (req, res, next) => {
    console.log("roleCheck:", req.user);
    const { role } = req.user;               // set by auth middleware
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden - insufficient role' });
    }
    next();
  };
};

// Admin Check Middleware (for admin or franchise roles)
const adminCheck = (req, res, next) => {
  try {
    const allowedRoles = ['admin', 'franchiseAdmin', 'franchiseEmployee'];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: Authorized roles only' });
    }
    next();
  } catch (error) {
    console.error('Admin Check Error:', error);
    return res.status(500).json({ error: 'Server error during role check' });
  }
};

// Super Admin Check (only for 'admin' role)
const superAdminCheck = (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Super admin only' });
    }
    next();
  } catch (error) {
    console.error('Super Admin Check Error:', error);
    return res.status(500).json({ error: 'Server error during super admin check' });
  }
};

module.exports = { auth, partnerAuth, authForDashboard, adminCheck, superAdminCheck, roleCheck };