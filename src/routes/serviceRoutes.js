const express = require('express');
const { auth, adminCheck } = require('../middleware/authMiddleware');
const { allServicesByVehicle } = require('../controllers/serviceController');

const router = express.Router();

router.get('/allServicesByVehicle', auth, allServicesByVehicle);

module.exports = router;