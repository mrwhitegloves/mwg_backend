const express = require('express');
const { auth, superAdminCheck, authForDashboard } = require('../middleware/authMiddleware');
const { getLoginUser, login, logout, createUser, getFranchiseAdmins } = require('../controllers/adminUserController');

const router = express.Router();

router.post('/login', login);
router.get('/me', authForDashboard, getLoginUser);
router.post('/logout', logout);
router.post('/signup', createUser);
router.get('/franchise-admins', auth, getFranchiseAdmins);

module.exports = router;