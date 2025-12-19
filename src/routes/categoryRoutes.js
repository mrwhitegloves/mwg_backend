const express = require('express');
const router = express.Router();
const { auth, adminCheck } = require('../middleware/authMiddleware');
const {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} = require('../controllers/categoryController');

// Public
router.get('/', getCategories);
router.get('/:id', getCategoryById);

// Admin Only
router.post('/', auth, adminCheck, ...createCategory);
router.put('/:id', auth, adminCheck, ...updateCategory);
router.delete('/:id', auth, adminCheck, deleteCategory);

module.exports = router;