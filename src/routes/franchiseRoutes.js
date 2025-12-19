// routes/franchiseRoutes.js
const express = require('express');
const router = express.Router();
const { auth, superAdminCheck } = require('../middleware/authMiddleware');
const {
  createFranchise,
  getFranchises,
  getFranchiseById,
  updateFranchise,
  deleteFranchise,
  checkAvailability
} = require('../controllers/franchiseController');

// PUBLIC / ADMIN
router.get('/check-availability', checkAvailability);
router.post('/create-franchise', auth, superAdminCheck, createFranchise);
router.get('/get-franchise', auth, getFranchises);
router.get('/:id', auth, getFranchiseById);
router.put('/:id', auth, superAdminCheck, updateFranchise);
router.delete('/:id', auth, superAdminCheck, deleteFranchise);

module.exports = router;