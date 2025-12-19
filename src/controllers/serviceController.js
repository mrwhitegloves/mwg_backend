const Service = require('../models/Service');
const User = require('../models/User');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
require('dotenv').config();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer setup for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
  storage, 
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Helper function to await Cloudinary upload
const uploadToCloudinary = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "image", folder: "admin_services" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(fileBuffer);
  });
};

// POST /api/services - Create service with Cloudinary upload
exports.createService = [
  upload.single('image'), // Handle single image file
  async (req, res) => {
    try {
      const {
        name,
        description,
        category,
        vehicleCategory,
        basePrice,
        durationMinutes,
        discountPercent,
        featuresList,
        isPopular,
        active,
      } = req.body;
      console.log("req.body in createService:- ", req.body)

      // Validation
      if (!name || !category || !vehicleCategory || basePrice == null || durationMinutes == null) {
        return res.status(400).json({ 
          error: 'Missing required fields: name, category, vehicleCategory, basePrice, durationMinutes' 
        });
      }

      const validCategories = ["Full Wash", "Exterior Wash", "Interior Cleaning", "Bike Wash", "Detailing"];
      const validVehicleCategories = ["Hatchback", "Sedan", "SUV", "Two wheeler"];
      
      if (!validCategories.includes(category) || !validVehicleCategories.includes(vehicleCategory)) {
        return res.status(400).json({ error: 'Invalid category or vehicleCategory' });
      }

      if (basePrice < 0 || durationMinutes <= 0) {
        return res.status(400).json({ error: 'basePrice must be >= 0 and durationMinutes > 0' });
      }

      if (discountPercent && (discountPercent < 0 || discountPercent > 100)) {
        return res.status(400).json({ error: 'discountPercent must be between 0 and 100' });
      }

      // Upload image to Cloudinary (wait for upload to complete)
      let imageUrl = "";
      if (req.file) {
        const uploadResult = await uploadToCloudinary(req.file.buffer);
        imageUrl = uploadResult.secure_url;
      }

      // Parse features list
      const parsedFeatures = featuresList ? featuresList?.split(',').map(f => f.trim()).filter(f => f) : [];

      // Create service
      const newService = new Service({
        name,
        description,
        category,
        vehicleCategory,
        basePrice: parseFloat(basePrice),
        durationMinutes: parseInt(durationMinutes),
        discountPercent: parseInt(discountPercent) || 0,
        imageUrl,
        featuresList: parsedFeatures,
        isPopular: isPopular === 'true' || isPopular === true,
        active: active === 'true' || active === true,
      });

      await newService.save();

      res.status(201).json({ 
        message: 'Service created successfully', 
        service: newService 
      });

    } catch (error) {
      console.error('Create Service Error:', error);
      
      // Cleanup uploaded file if service creation failed
      if (req.file && imageUrl) {
        await cloudinary.uploader.destroy(cloudinary.utils.api_sign_request({
          public_id: imageUrl.split('/').pop().split('.')[0]
        }));
      }

      if (error.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
      }
      if (error.message === 'Image upload failed') {
        return res.status(400).json({ error: 'Image upload failed. Please try again.' });
      }
      res.status(500).json({ error: 'Server error while creating service' });
    }
  }
];

// GET /api/services - Get services with pagination (UNCHANGED)
exports.getAllServices = async (req, res) => {
  const {
    page = 1,
    limit = 9,
    search = '',
    category = '',
    vehicleCategory = '',
    status = 'active'
  } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  try {
    const filter = { active: status === 'active' };

    if (category) {
      const validCategories = ["Full Wash, Exterior Wash", "Interior Cleaning", "Bike Wash", "Detailing"];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category filter' });
      }
      filter.category = category;
    }

    if (vehicleCategory) {
      const validVehicleCategories = ["Hatchback", "Sedan", "SUV", "Two wheeler"];
      if (!validVehicleCategories.includes(vehicleCategory)) {
        return res.status(400).json({ error: 'Invalid vehicleCategory filter' });
      }
      filter.vehicleCategory = vehicleCategory;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (pageNum - 1) * limitNum;

    const services = await Service.find(filter)
      .populate('reviews.user', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const totalServices = await Service.countDocuments(filter);

    res.json({
      services,
      pagination: {
        current: pageNum,
        pages: Math.ceil(totalServices / limitNum),
        total: totalServices,
        limit: limitNum,
        hasNext: pageNum * limitNum < totalServices,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error('Get Services Error:', error);
    res.status(500).json({ error: 'Server error while fetching services' });
  }
};

// ... (other methods remain unchanged)

// GET /api/services/:id - Get single service
exports.getServiceById = async (req, res) => {
  try {
    const service = await Service.findById(req.params.id)
      .populate('reviews.user', 'name')
      .lean();
    
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({ service });
  } catch (error) {
    console.error('Get Service Error:', error);
    res.status(500).json({ error: 'Server error while fetching service' });
  }
};

// PUT /api/services/:id - Update service
exports.updateService = async (req, res) => {
  console.log("test 1")
  try {
    const {
      name,
      description,
      category,
      vehicleCategory,
      basePrice,
      durationMinutes,
      discountPercent,
      featuresList,
      isPopular,
      active,
    } = req.body;
    console.log("test 2")

    const validCategories = ["Full Wash", "Exterior Wash", "Interior Cleaning", "Bike Wash", "Detailing"];
    const validVehicleCategories = ["Hatchback", "Sedan", "SUV", "Two wheeler"];
    console.log("test 3", category)
    console.log("test 33", featuresList)

    if (category && !validCategories.includes(category)) {
      console.log("test 4")
      return res.status(400).json({ error: 'Invalid category' });
    }
    console.log("test 5")

    if (vehicleCategory && !validVehicleCategories.includes(vehicleCategory)) {
      console.log("test 6")
      return res.status(400).json({ error: 'Invalid vehicleCategory' });
    }
    console.log("test 7")

    const updateData = {
      name,
      description,
      category,
      vehicleCategory,
      basePrice,
      durationMinutes,
      discountPercent,
      featuresList: Array.isArray(featuresList) ? featuresList.map(f => f.trim()) : typeof featuresList === 'string' ? featuresList.split(',').map(f => f.trim()) : undefined,
      isPopular,
      active,
    };
    console.log("test 8")

    // Remove undefined values
    Object.keys(updateData).forEach(key => 
      updateData[key] === undefined && delete updateData[key]
    );
    console.log("test 9")
    console.log("req.params.id",req.params.id)

    const service = await Service.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('reviews.user', 'name');
    console.log("test 10")

    if (!service) {
      console.log("test 11")
      console.log("service", service)
      return res.status(404).json({ error: 'Service not found' });
    }
    console.log("test 12")

    res.json({ message: 'Service updated successfully', service });
  } catch (error) {
    console.log("test 13", error)
    console.error('Update Service Error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Server error while updating service' });
  }
};

// DELETE /api/services/:id - Delete service
exports.deleteService = async (req, res) => {
  try {
    const service = await Service.findByIdAndDelete(req.params.id);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    console.error('Delete Service Error:', error);
    res.status(500).json({ error: 'Server error while deleting service' });
  }
};

// GET /api/services/allServicesByVehicle (Home: Filtered by location + vehicle)
exports.allServicesByVehicle = async (req, res) => {
  const user = await User.findById(req.user.userId);

  let query = { active: true, vehicleCategory: user.vehicles?.type };

  const services = await Service.find(query);

  res.json(services);
};