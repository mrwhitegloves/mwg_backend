const express = require('express');
const { sendOtp, verifyOtp, register, login, getMe, profile, vehicle, location, refreshToken, avatar_upload_url, getAllUsers, getUserById, updateUserStatus, deleteUser, addDeliveryAddress, getDeliveryAddresses, updateVehicle, logout, updateProfile, getBrands, getModelsByBrand, updateDeliveryAddress } = require('../controllers/userController');
const { auth } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', auth, logout);
router.get('/me', auth, getMe);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/avatar_upload_url', auth, avatar_upload_url);
router.post('/profile', auth, profile);
router.get('/brands', getBrands);
router.get('/models/:brandId', getModelsByBrand);
router.post('/vehicle', auth, vehicle);
router.post('/location', auth, location);
router.patch('/vehicles/:vehicleId', auth, updateVehicle);
router.post('/refresh-token', auth, refreshToken);
router.post('/delivery-address', auth, addDeliveryAddress);
router.get('/delivery-address', auth, getDeliveryAddresses);
router.get('/', getAllUsers);
router.patch('/me', auth, updateProfile);
router.get('/:id', auth, getUserById);
router.put('/delivery-address/:addressId', auth, updateDeliveryAddress);
router.put('/:id', auth, updateUserStatus);
router.delete('/:id', auth, deleteUser);

module.exports = router;