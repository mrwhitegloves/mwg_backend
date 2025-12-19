const express = require('express');
const { auth, adminCheck } = require('../middleware/authMiddleware');
const { createService, getAllServices, getServiceById, updateService, deleteService } = require('../controllers/serviceController');

const router = express.Router();

router.post('/', auth, adminCheck, createService);
router.get('/', getAllServices);
router.get('/:id', getServiceById);
router.put('/:id', updateService);
router.delete('/:id', deleteService);

module.exports = router;