const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Vehicle = require("../models/Vehicle");
const { generateToken } = require('../utils/generateToken');
const cloudinary = require('cloudinary').v2;
const multer = require("multer");
const crypto = require('crypto');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_WHATSAPP_URL = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';
const MSG91_INTEGRATED_NUMBER = '919279011375';

// Config Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const OTP_EXPIRY = 5 * 60 * 1000; // 5 min

// Generate 6-digit OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendWhatsAppOtpViaMSG91 = async (phone, otp) => {
  const payload = {
    integrated_number: MSG91_INTEGRATED_NUMBER,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: "login_otp", // must match MSG91 template name
        language: {
          code: "en_GB",
          policy: "deterministic"
        },
        namespace: "6bf6d355_46eb_450c_95c9_d4142991644c",
        to_and_components: [
          {
            to: [phone], // phone WITHOUT +
            components: {
              body_1: {
                type: "text",
                value: otp // OTP injected here
              },
              button_1: {
                subtype: "url",
                type: "text",
                value: otp
              }
            }
          }
        ]
      }
    }
  };

  return axios.post(MSG91_WHATSAPP_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      "authkey": MSG91_AUTH_KEY
    }
  });
};


const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else if (
      file.fieldname === "documents" &&
      ["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)
    )
      cb(null, true);
    else cb(new Error("Invalid file type"), false);
  },
});

const uploadSingleToCloudinary = (file, folder) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      return resolve(null);
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: file.mimetype.includes('pdf') ? 'raw' : 'image',
        folder
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            name: file.originalname,
            url: result.secure_url
          });
        }
      }
    );

    stream.end(file.buffer);
  });
};

// POST /api/auth/send-otp (Step 1: Send OTP via WhatsApp)
exports.sendOtp = async (req, res) => {
  console.log("Login route test")
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ message: 'Phone required' });

  const otp = generateOtp();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY);

  try {
  let user = await User.findOne({ phone });
  if (!user) {
    user = new User({ phone, otp, otpExpiry, onboardingStep: 'phone' });
  } else {
    user.otp = otp;
    user.otpExpiry = otpExpiry;
  }
  await user.save();

  // Send OTP via MSG91 WhatsApp
  try {
      const test = await sendWhatsAppOtpViaMSG91(phone, otp);
      console.log("test send otp")
    } catch (waError) {
      console.error(
        "MSG91 WhatsApp Error:",
        waError.response?.data || waError.message
      );

      return res.status(400).json({
        message: "WhatsApp OTP failed",
        error: waError.response?.data || "Number not registered on WhatsApp"
      });
    }

  res.json({ message: 'OTP sent via WhatsApp', user });
  } catch (error) {
    console.error('OTP Error:', error);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
};


// POST /api/auth/verify-otp (Step 2: Verify OTP)
exports.verifyOtp = async (req, res) => {
  const { phone, otp } = req.body;
  const user = await User.findOne({ phone });

  if (!user || user.otp !== otp || Date.now() > user.otpExpiry) {
    return res.status(400).json({ error: 'Invalid/expired OTP' });
  }

  try {

  // Clear OTP
  user.otp = undefined;
  user.otpExpiry = undefined;

  // Generate JWT
  const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

  // Check if first time
  if (!user.name) { // Assuming name filled in profile
    user.onboardingStep = 'profile';
    await user.save();
    return res.json({ token, user, redirect: '/profile-form' }); // Frontend redirect
  } else if (!user.vehicles) {
    user.onboardingStep = 'vehicle';
    await user.save();
    return res.json({ token, user, redirect: '/vehicle-form' });
  } else if (!user.currentLocation) {
    user.onboardingStep = 'location';
    await user.save();
    return res.json({ token, user, redirect: '/location-finding' });
  } else {
    user.onboardingStep = 'complete';
    await user.save();
    return res.json({ token, user, redirect: '/(tabs)/home' });
  }
  } catch (error) {
    console.error('OTP Verification Error:', error);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
};

// ────── PATCH /api/user/me – Update Profile ──────
exports.updateProfile = async (req, res) => {
  const { name, email, profileImage } = req.body;

  if (!name && !email && !profileImage) {
    return res.status(400).json({ error: 'At least one field required' });
  }

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (name) user.name = name;
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) return res.status(400).json({ error: 'Email already in use' });
      user.email = email;
    }
    if (profileImage) user.profileImage = profileImage;

    await user.save();

    const updatedUser = await User.findById(req.user.userId)
      .select('-otp -otpExpiry -passwordHash')
      .populate('vehicles', 'type make model year registrationNumber');

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Update Profile Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/user/avatar-upload-url (Generate presigned URL for direct upload)
exports.avatar_upload_url = async (req, res) => {
  const { fileType } = req.body;
  const publicId = `users/${req.user.userId}_${Date.now()}`; // Unique ID
  const timestamp = Math.round(new Date().getTime() / 1000);

  // Generate signature
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, public_id: publicId },
    process.env.CLOUDINARY_API_SECRET
  );

  const uploadUrl = cloudinary.utils.api_url('upload', {
    resource_type: 'image',
  }) + `?api_key=${process.env.CLOUDINARY_API_KEY}&timestamp=${timestamp}&public_id=${publicId}&signature=${signature}`;

  const imageUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${publicId}.jpg`;

  res.json({ uploadUrl, publicId, imageUrl });
};

// Updated POST /api/user/profile
exports.profile = async (req, res) => {
  const { name, email, profileImage } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  try {

  const user = await User.findById(req.user.userId);
  user.name = name;
  user.email = email;
  if (profileImage) user.profileImage = profileImage;
  user.onboardingStep = 'vehicle';
  await user.save();
  res.json({ redirect: '/vehicle-form' });
  } catch (error) {
    console.error('Profile Update Error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

exports.register = async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  try {
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User exists' });

    const user = await User.create({ name, email, phone, passwordHash: password, role });
    res.status(201).json({ token: generateToken(user._id) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    res.json({ token: generateToken(user._id) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('-otp -otpExpiry -passwordHash') // Hide sensitive fields
      .populate('vehicles', 'type make model year registrationNumber');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'User profile fetched successfully',
      user,
    });
  } catch (error) {
    console.error('Get Me Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ────── GET /api/auth/brands (GoMechanic Brands) ──────
exports.getBrands = async (req, res) => {
  try {
    const response = await fetch('https://gomechanic.in/api/v1/get-brands');
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch brands' });
  }
};

// ────── GET /api/auth/models/:brandId (GoMechanic Models) ──────
exports.getModelsByBrand = async (req, res) => {
  const { brandId } = req.params;
  try {
    const response = await fetch(`https://gomechanic.app/api/v2/oauth/vehicles/get_models_by_brand/?brand_id=${brandId}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch models' });
  }
};

// Helper: Clean segment
const cleanSegment = (segment) => {
  if (!segment) return 'Hatchback';
  return segment.replace(/Premium\s+/gi, '').trim(); // Remove "Premium"
};

// ────── POST /api/auth/vehicle (New Flow with RC Number) ──────
// exports.vehicle = async (req, res) => {
//   const { rcNumber, make, model, brandId } = req.body;

//   // Validation
//   if (!rcNumber || !make || !model || !brandId) {
//     return res.status(400).json({ error: 'RC Number, Make, Model, and Brand ID are required' });
//   }

//   try {
//     const user = await User.findById(req.user.userId);
//     if (!user) return res.status(404).json({ error: 'User not found' });

//     // 1. Call QuickEKYC API with RC Number
//     const quickEKYCRes = await fetch('https://api.quickekyc.com/api/v1/rc/rc_sp', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ key: process.env.QUICK_EKYC_API_KEY, id_number: rcNumber }),
//     });
//     const quickEKYCData = await quickEKYCRes.json();

//     if (quickEKYCData.status !== 'success') {
//       return res.status(400).json({ error: 'Invalid RC number' });
//     }

//     const rc = quickEKYCData.data;

//     // 2. Get segment from GoMechanic model API
//     const modelRes = await fetch(`https://gomechanic.app/api/v2/oauth/vehicles/get_models_by_brand/?brand_id=${brandId}`);
//     const modelData = await modelRes.json();

//     // Find selected model and get segment
//     const selectedModel = modelData.data.find(m => m.name.toLowerCase() === model.toLowerCase());
//     const segment = cleanSegment(selectedModel.Segment); // Remove "Premium"

//     // 3. Save to user vehicles
//     const newVehicle = {
//       type: segment,
//       make,
//       model,
//       year: parseInt(rc.manufacturing_date.split('/')[1]) || new Date().getFullYear(),
//       registrationNumber: rcNumber,
//       fuel_type: rc.fuel_type,
//       color: rc.color,
//       isActive: true,

//       // All QuickEKYC fields
//       rc_number: rc.rc_number,
//       fit_up_to: new Date(rc.fit_up_to),
//       registration_date: new Date(rc.registration_date),
//       owner_name: rc.owner_name,
//       father_name: rc.father_name,
//       present_address: rc.present_address,
//       permanent_address: rc.permanent_address,
//       mobile_number: rc.mobile_number,
//       vehicle_category: rc.vehicle_category,
//       vehicle_chasi_number: rc.vehicle_chasi_number,
//       vehicle_engine_number: rc.vehicle_engine_number,
//       maker_description: rc.maker_description,
//       maker_model: rc.maker_model,
//       body_type: rc.body_type,
//       norms_type: rc.norms_type,
//       financer: rc.financer,
//       financed: rc.financed,
//       insurance_company: rc.insurance_company,
//       insurance_policy_number: rc.insurance_policy_number,
//       insurance_upto: new Date(rc.insurance_upto),
//       manufacturing_date: new Date(`${rc.manufacturing_date_formatted}-01`),
//       registered_at: rc.registered_at,
//       tax_upto: new Date(rc.tax_upto),
//       tax_paid_upto: rc.tax_paid_upto,
//       cubic_capacity: rc.cubic_capacity,
//       vehicle_gross_weight: rc.vehicle_gross_weight,
//       no_cylinders: rc.no_cylinders,
//       seat_capacity: rc.seat_capacity,
//       sleeper_capacity: rc.sleeper_capacity,
//       standing_capacity: rc.standing_capacity,
//       wheelbase: rc.wheelbase,
//       unladen_weight: rc.unladen_weight,
//       vehicle_category_description: rc.vehicle_category_description,
//       pucc_number: rc.pucc_number,
//       pucc_upto: new Date(rc.pucc_upto),
//       permit_number: rc.permit_number,
//       permit_issue_date: new Date(rc.permit_issue_date),
//       permit_valid_from: new Date(rc.permit_valid_from),
//       permit_valid_upto: new Date(rc.permit_valid_upto),
//       permit_type: rc.permit_type,
//       national_permit_number: rc.national_permit_number,
//       national_permit_upto: new Date(rc.national_permit_upto),
//       national_permit_issued_by: rc.national_permit_issued_by,
//       non_use_status: rc.non_use_status,
//       non_use_from: new Date(rc.non_use_from),
//       non_use_to: new Date(rc.non_use_to),
//       blacklist_status: rc.blacklist_status,
//       noc_details: rc.noc_details,
//       owner_number: rc.owner_number,
//       rc_status: rc.rc_status,
//       masked_name: rc.masked_name,
//       challan_details: rc.challan_details,
//       variant: rc.variant,
//       rto_code: rc.rto_code,
//     };

//     user.vehicles = newVehicle;
//     user.onboardingStep = 'location';
//     await user.save();

//     res.json({ message: 'Vehicle saved', redirect: '/location-finding' });
//   } catch (error) {
//     console.error('Vehicle creation error:', error);
//     res.status(500).json({ error: 'Failed to save vehicle' });
//   }
// };

// ────── POST /api/auth/vehicle (NEW AI-POWERED FLOW) ──────
exports.vehicle = async (req, res) => {
  const { rcNumber } = req.body;

  // Validation
  if (!rcNumber || !rcNumber.trim()) {
    return res.status(400).json({ error: "RC Number is required" });
  }

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // STEP 1: CHECK IF VEHICLE ALREADY EXISTS IN OUR CACHE (Vehicle collection)
    let cachedVehicle = await Vehicle.findOne({ registrationNumber: rcNumber });

    if (cachedVehicle) {
      console.log("Vehicle found in cache! Reusing instantly...");

      // REUSE CACHED DATA — NO API CALL, NO GEMINI, 50ms response
      user.vehicles = {
        type: cachedVehicle.type,
        make: cachedVehicle.make,
        model: cachedVehicle.model,
        year: cachedVehicle.year,
        registrationNumber: cachedVehicle.registrationNumber,
        fuel_type: cachedVehicle.fuel_type,
        color: cachedVehicle.color,
        isActive: true,
        // Copy ALL fields from cached vehicle
        rc_number: cachedVehicle.rc_number,
        fit_up_to: cachedVehicle.fit_up_to,
        registration_date: cachedVehicle.registration_date,
        owner_name: cachedVehicle.owner_name,
        father_name: cachedVehicle.father_name,
        present_address: cachedVehicle.present_address,
        permanent_address: cachedVehicle.permanent_address,
        mobile_number: cachedVehicle.mobile_number,
        vehicle_category: cachedVehicle.vehicle_category,
        vehicle_chasi_number: cachedVehicle.vehicle_chasi_number,
        vehicle_engine_number: cachedVehicle.vehicle_engine_number,
        maker_description: cachedVehicle.maker_description,
        maker_model: cachedVehicle.maker_model,
        body_type: cachedVehicle.body_type,
        norms_type: cachedVehicle.norms_type,
        financer: cachedVehicle.financer,
        financed: cachedVehicle.financed,
        insurance_company: cachedVehicle.insurance_company,
        insurance_policy_number: cachedVehicle.insurance_policy_number,
        insurance_upto: cachedVehicle.insurance_upto,
        manufacturing_date: cachedVehicle.manufacturing_date,
        registered_at: cachedVehicle.registered_at,
        tax_upto: cachedVehicle.tax_upto,
        tax_paid_upto: cachedVehicle.tax_paid_upto,
        cubic_capacity: cachedVehicle.cubic_capacity,
        vehicle_gross_weight: cachedVehicle.vehicle_gross_weight,
        no_cylinders: cachedVehicle.no_cylinders,
        seat_capacity: cachedVehicle.seat_capacity,
        sleeper_capacity: cachedVehicle.sleeper_capacity,
        standing_capacity: cachedVehicle.standing_capacity,
        wheelbase: cachedVehicle.wheelbase,
        unladen_weight: cachedVehicle.unladen_weight,
        vehicle_category_description: cachedVehicle.vehicle_category_description,
        pucc_number: cachedVehicle.pucc_number,
        pucc_upto: cachedVehicle.pucc_upto,
        permit_number: cachedVehicle.permit_number,
        permit_issue_date: cachedVehicle.permit_issue_date,
        permit_valid_from: cachedVehicle.permit_valid_from,
        permit_valid_upto: cachedVehicle.permit_valid_upto,
        permit_type: cachedVehicle.permit_type,
        national_permit_number: cachedVehicle.national_permit_number,
        national_permit_upto: cachedVehicle.national_permit_upto,
        national_permit_issued_by: cachedVehicle.national_permit_issued_by,
        non_use_status: cachedVehicle.non_use_status,
        non_use_from: cachedVehicle.non_use_from,
        non_use_to: cachedVehicle.non_use_to,
        blacklist_status: cachedVehicle.blacklist_status,
        noc_details: cachedVehicle.noc_details,
        owner_number: cachedVehicle.owner_number,
        rc_status: cachedVehicle.rc_status,
        masked_name: cachedVehicle.masked_name,
        challan_details: cachedVehicle.challan_details,
        variant: cachedVehicle.variant,
        rto_code: cachedVehicle.rto_code,
      };

      user.onboardingStep = "location";
      await user.save();

      return res.json({
        message: "Vehicle added instantly from cache",
        segment: cachedVehicle.type,
        make: cachedVehicle.make,
        model: cachedVehicle.model,
      });
    }

    // STEP 2: NOT CACHED → CALL QUICKEKYC + GEMINI (ONLY FIRST TIME)
    console.log("First time RC → Calling QuickEKYC + Gemini...");

    const quickEKYCRes = await fetch("https://api.quickekyc.com/api/v1/rc/rc_sp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: process.env.QUICK_EKYC_API_KEY,
        id_number: rcNumber.trim().toUpperCase(),
      }),
    });

    const quickEKYCData = await quickEKYCRes.json();
    if (quickEKYCData.status !== "success") {
      return res.status(400).json({ error: "Invalid or unregistered RC number" });
    }

    const rc = quickEKYCData.data;
    console.log("RC Data rc.maker_description:", rc.maker_description);
    console.log("RC Data rc.maker_model:", rc);

    // 3. GEMINI USING OFFICIAL SDK — PERFECT OUTPUT EVERY TIME
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash", // This works perfectly with SDK
    });

    const prompt = `Classify this Indian or International car and two wheeler into ONE segment only: Sedan, Hatchback, SUV, Two wheeler.
Reply with ONLY the segment name. No explanation.

Vehicle Details:
- Maker: ${rc.maker_description || "Unknown"}
- Model: ${rc.maker_model || "Unknown"}

Examples:
Swift Dzire → Sedan
Baleno → Hatchback
Creta → SUV
WagonR → Hatchback
ACTIVA 5G → Two wheeler
TVS Jupiter 125 → Two wheeler

Classify this vehicle:`;

    const result = await model.generateContent(prompt);
    console.log("result in gemini:-", result)
    const responseText = result.response.text().trim();
    console.log("responseText:-", responseText)

    // 4. Final validation: Only allow our 3 segments
    const validSegments = ["Sedan", "Hatchback", "SUV", "Two wheeler"];
    const segment = validSegments.includes(responseText) ? responseText : "Invalid";
    if(segment === "Invalid"){
      return res.status(400).json({ error: "Vehicle saved failed" });
    }


    // 5. Save vehicle with AI-detected segment
    user.vehicles = {
      type: segment,                                      // ← AI-Powered Segment
      make: rc.maker_description || "Unknown",
      model: rc.maker_model || "Unknown",
      year: parseInt(rc.manufacturing_date.split("/")[1]) || new Date().getFullYear(),
      registrationNumber: rcNumber.trim().toUpperCase(),
      fuel_type: rc.fuel_type || "Unknown",
      color: rc.color || "Unknown",
      isActive: true,

      // All QuickEKYC fields (unchanged)
      rc_number: rc.rc_number,
      fit_up_to: new Date(rc.fit_up_to),
      registration_date: new Date(rc.registration_date),
      owner_name: rc.owner_name,
      father_name: rc.father_name,
      present_address: rc.present_address,
      permanent_address: rc.permanent_address,
      mobile_number: rc.mobile_number,
      vehicle_category: rc.vehicle_category,
      vehicle_chasi_number: rc.vehicle_chasi_number,
      vehicle_engine_number: rc.vehicle_engine_number,
      maker_description: rc.maker_description,
      maker_model: rc.maker_model,
      body_type: rc.body_type,
      norms_type: rc.norms_type,
      financer: rc.financer,
      financed: rc.financed,
      insurance_company: rc.insurance_company,
      insurance_policy_number: rc.insurance_policy_number,
      insurance_upto: new Date(rc.insurance_upto),
      manufacturing_date: new Date(`${rc.manufacturing_date_formatted}-01`),
      registered_at: rc.registered_at,
      tax_upto: new Date(rc.tax_upto),
      tax_paid_upto: rc.tax_paid_upto,
      cubic_capacity: rc.cubic_capacity,
      vehicle_gross_weight: rc.vehicle_gross_weight,
      no_cylinders: rc.no_cylinders,
      seat_capacity: rc.seat_capacity,
      sleeper_capacity: rc.sleeper_capacity,
      standing_capacity: rc.standing_capacity,
      wheelbase: rc.wheelbase,
      unladen_weight: rc.unladen_weight,
      vehicle_category_description: rc.vehicle_category_description,
      pucc_number: rc.pucc_number,
      pucc_upto: new Date(rc.pucc_upto),
      permit_number: rc.permit_number,
      permit_issue_date: rc.permit_issue_date ? new Date(rc.permit_issue_date) : null,
      permit_valid_from: rc.permit_valid_from ? new Date(rc.permit_valid_from) : null,
      permit_valid_upto: rc.permit_valid_upto ? new Date(rc.permit_valid_upto) : null,
      permit_type: rc.permit_type,
      national_permit_number: rc.national_permit_number,
      national_permit_upto: rc.national_permit_upto ? new Date(rc.national_permit_upto) : null,
      national_permit_issued_by: rc.national_permit_issued_by,
      non_use_status: rc.non_use_status,
      non_use_from: rc.non_use_from ? new Date(rc.non_use_from) : null,
      non_use_to: rc.non_use_to ? new Date(rc.non_use_to) : null,
      blacklist_status: rc.blacklist_status,
      noc_details: rc.noc_details,
      owner_number: rc.owner_number,
      rc_status: rc.rc_status,
      masked_name: rc.masked_name,
      challan_details: rc.challan_details,
      variant: rc.variant,
      rto_code: rc.rto_code,
    };

    // STEP 6: CACHE IT IN Vehicle COLLECTION FOR NEXT USER
    await new Vehicle({
      type: segment,                                      // ← AI-Powered Segment
      make: rc.maker_description || "Unknown",
      model: rc.maker_model || "Unknown",
      year: parseInt(rc.manufacturing_date.split("/")[1]) || new Date().getFullYear(),
      registrationNumber: rcNumber.trim().toUpperCase(),
      fuel_type: rc.fuel_type || "Unknown",
      color: rc.color || "Unknown",
      isActive: true,

      // All QuickEKYC fields (unchanged)
      rc_number: rc.rc_number,
      fit_up_to: new Date(rc.fit_up_to),
      registration_date: new Date(rc.registration_date),
      owner_name: rc.owner_name,
      father_name: rc.father_name,
      present_address: rc.present_address,
      permanent_address: rc.permanent_address,
      mobile_number: rc.mobile_number,
      vehicle_category: rc.vehicle_category,
      vehicle_chasi_number: rc.vehicle_chasi_number,
      vehicle_engine_number: rc.vehicle_engine_number,
      maker_description: rc.maker_description,
      maker_model: rc.maker_model,
      body_type: rc.body_type,
      norms_type: rc.norms_type,
      financer: rc.financer,
      financed: rc.financed,
      insurance_company: rc.insurance_company,
      insurance_policy_number: rc.insurance_policy_number,
      insurance_upto: new Date(rc.insurance_upto),
      manufacturing_date: new Date(`${rc.manufacturing_date_formatted}-01`),
      registered_at: rc.registered_at,
      tax_upto: new Date(rc.tax_upto),
      tax_paid_upto: rc.tax_paid_upto,
      cubic_capacity: rc.cubic_capacity,
      vehicle_gross_weight: rc.vehicle_gross_weight,
      no_cylinders: rc.no_cylinders,
      seat_capacity: rc.seat_capacity,
      sleeper_capacity: rc.sleeper_capacity,
      standing_capacity: rc.standing_capacity,
      wheelbase: rc.wheelbase,
      unladen_weight: rc.unladen_weight,
      vehicle_category_description: rc.vehicle_category_description,
      pucc_number: rc.pucc_number,
      pucc_upto: new Date(rc.pucc_upto),
      permit_number: rc.permit_number,
      permit_issue_date: rc.permit_issue_date ? new Date(rc.permit_issue_date) : null,
      permit_valid_from: rc.permit_valid_from ? new Date(rc.permit_valid_from) : null,
      permit_valid_upto: rc.permit_valid_upto ? new Date(rc.permit_valid_upto) : null,
      permit_type: rc.permit_type,
      national_permit_number: rc.national_permit_number,
      national_permit_upto: rc.national_permit_upto ? new Date(rc.national_permit_upto) : null,
      national_permit_issued_by: rc.national_permit_issued_by,
      non_use_status: rc.non_use_status,
      non_use_from: rc.non_use_from ? new Date(rc.non_use_from) : null,
      non_use_to: rc.non_use_to ? new Date(rc.non_use_to) : null,
      blacklist_status: rc.blacklist_status,
      noc_details: rc.noc_details,
      owner_number: rc.owner_number,
      rc_status: rc.rc_status,
      masked_name: rc.masked_name,
      challan_details: rc.challan_details,
      variant: rc.variant,
      rto_code: rc.rto_code,
    }).save();

    user.onboardingStep = "location";
    await user.save();

    res.json({
      message: "Vehicle added successfully with AI segment detection",
      segment: segment,
      make: user.vehicles.make,
      model: user.vehicles.model,
    });
  } catch (error) {
    console.error("AI Vehicle creation error:", error.message);
    res.status(500).json({ error: "Failed to process vehicle. Please try again." });
  }
};

// ────── PATCH /api/auth/vehicles/:vehicleId ──────
exports.updateVehicle = async (req, res) => {
  const { vehicleId } = req.params;
  const { type, make, model, year, registrationNumber, fuel_type, color } = req.body;

  // Validation (same as create)
  const validTypes = ["Two wheeler", "Hatchback", "Sedan", "SUV"];
  const validFuels = ["Petrol", "Diesel", "Electric", "Hybrid"];

  if (type && !validTypes.includes(type)) {
    return res.status(400).json({ error: 'Invalid vehicle type' });
  }
  if (fuel_type && !validFuels.includes(fuel_type)) {
    return res.status(400).json({ error: 'Invalid fuel type' });
  }
  if (year && (isNaN(year) || year < 1900 || year > new Date().getFullYear())) {
    return res.status(400).json({ error: 'Invalid year' });
  }
  if (!make && !model && !year && !registrationNumber && !fuel_type && !color && !type) {
    return res.status(400).json({ error: 'At least one field required to update' });
  }

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Find vehicle index
    const vehicleIndex = user.vehicles.findIndex(v => v._id.toString() === vehicleId);
    if (vehicleIndex === -1) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    // Update fields (only if provided)
    const vehicle = user.vehicles[vehicleIndex];
    if (type) vehicle.type = type;
    if (make) vehicle.make = make;
    if (model) vehicle.model = model;
    if (year) vehicle.year = parseInt(year);
    if (registrationNumber) vehicle.registrationNumber = registrationNumber;
    if (fuel_type) vehicle.fuel_type = fuel_type;
    if (color) vehicle.color = color;

    await user.save();

    // Refetch fresh user for response
    const updatedUser = await User.findById(req.user.userId)
      .select('-otp -otpExpiry -passwordHash')
      .populate('vehicles', 'type make model year registrationNumber fuel_type color');

    res.json({
      message: 'Vehicle updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Update Vehicle Error:', error);
    res.status(500).json({ error: 'Server error while updating vehicle' });
  }
};

// POST /api/auth/location (Save address and update currentLocation)
exports.location = async (req, res) => {
  const { label, street, city, state, postalCode, latitude, longitude, fullAddress, isDefault } = req.body;
  console.log("fullAddress",fullAddress)
  
  if (!fullAddress && (!street || !city)) {
    return res.status(400).json({ error: 'Full address or street + city required' });
  }

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Add/update address
    const address = {
      label: label || 'Home',
      street: street || '',
      city,
      state,
      postalCode,
      latitude,
      longitude,
      fullAddress, // Complete Google Places string
      isDefault: isDefault || true,
    };

    // Remove duplicates and add new one
    user.addresses = user.addresses.filter(addr => addr.fullAddress !== fullAddress);
    user.addresses.unshift(address); // Add to front

    // Update current location
    if (latitude && longitude) {
      user.currentLocation = {
        type: 'Point',
        coordinates: [latitude, longitude], // [lat, lng]
      };
    }

    user.onboardingStep = 'complete';
    await user.save();

    res.json({ message: 'Location saved', redirect: '/(tabs)/home' });
  } catch (error) {
    console.error('Location Save Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/admin/users/:id - Get single user by ID
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-otp -otpExpiry -passwordHash') // Hide sensitive fields
      .populate('vehicles', 'type make model year registrationNumber');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Get User Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/admin/users - Get all users with pagination, search, status filter
exports.getAllUsers = async (req, res) => {
  const {
    page = 1,
    limit = 10,
    search = '',
    status = '', // 'active', 'inactive'
    role = '',  // 'customer', 'admin'
  } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  try {
    // Build filter
    let filter = {};

    // Status filter (active/inactive based on 'active' field)
    if (status) {
      filter.active = status === 'active';
    }

    // Role filter
    if (role && ['customer', 'admin'].includes(role)) {
      filter.role = role;
    }

    // Search filter
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (pageNum - 1) * limitNum;

    // Get users
    const users = await User.find(filter)
      .select('-otp -otpExpiry -passwordHash -documents') // Hide sensitive fields
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('vehicles', 'type make model year registrationNumber');

    const totalUsers = await User.countDocuments(filter);

    res.json({
      users,
      pagination: {
        current: pageNum,
        pages: Math.ceil(totalUsers / limitNum),
        total: totalUsers,
        limit: limitNum,
        hasNext: pageNum * limitNum < totalUsers,
        hasPrev: pageNum > 1,
      },
    });

  } catch (error) {
    console.error('Get All Users Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ────── POST /api/user/logout – Clear FCM Token ──────
exports.logout = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Clear FCM token → stop push notifications
    user.fcmToken = undefined;
    await user.save();

    res.json({ 
      message: 'Logged out successfully',
      // Frontend will delete AsyncStorage token
    });
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// PUT /api/admin/users/:id - Update user status
exports.updateUserStatus = async (req, res) => {
  try {
    const { active } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { active: active === 'true' || active === true },
      { new: true, runValidators: true }
    ).select('-otp -otpExpiry -passwordHash');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      message: 'User status updated successfully', 
      user 
    });

  } catch (error) {
    console.error('Update User Status Error:', error);
    res.status(400).json({ error: error.message });
  }
};

// DELETE /api/admin/users/:id - Delete user
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete profile image from Cloudinary
    if (user.profileImage) {
      const publicId = user.profileImage.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(publicId);
    }

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Delete User Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/user/delivery-address
exports.addDeliveryAddress = async (req, res) => {
  const { name, phone, street, city, state, postalCode, label = 'Home' } = req.body;

  if (!name || !phone || !street || !city) {
    return res.status(400).json({ error: 'Name, phone, street, and city are required' });
  }

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newAddress = {
      name,
      phone,
      street,
      city,
      state,
      postalCode,
      label,
    };

    user.deliveryAddresses.push(newAddress);
    await user.save();

    res.status(201).json({
      message: 'Delivery address added',
      deliveryAddresses: user.deliveryAddresses,
    });
  } catch (error) {
    console.error('Add Delivery Address Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/user/delivery-addresses
exports.getDeliveryAddresses = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('deliveryAddresses');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ deliveryAddresses: user.deliveryAddresses });
  } catch (error) {
    console.error('Get Delivery Addresses Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.refreshToken = (req, res) => {
  res.json({ token: generateToken(req.user._id) });
};