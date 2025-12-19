const Category = require('../models/Category');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
require('dotenv').config();

// =============================
// CLOUDINARY CONFIG
// =============================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// =============================
// MULTER: Memory Storage (no disk)
// =============================
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// =============================
// HELPER: Upload to Cloudinary from Buffer
// =============================
const uploadToCloudinary = (fileBuffer, folder = 'categories') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'fill' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(fileBuffer);
  });
};

// =============================
// CREATE CATEGORY
// =============================
exports.createCategory = [
  upload.single('image'), // field name: 'image'
  async (req, res) => {
    try {
      const { name } = req.body;
      const file = req.file;

      if (!name?.trim()) {
        return res.status(400).json({ error: 'Category name is required' });
      }
      if (!file) {
        return res.status(400).json({ error: 'Category image is required' });
      }

      // Upload image to Cloudinary
      let imageUrl = '';
      try {
        const uploadResult = await uploadToCloudinary(file.buffer, 'categories');
        imageUrl = uploadResult.secure_url;
      } catch (uploadError) {
        console.error('Cloudinary Upload Failed:', uploadError);
        return res.status(500).json({ error: 'Image upload failed' });
      }

      // Save to DB
      const category = new Category({
        name: name.trim(),
        image: imageUrl,
      });

      await category.save();

      res.status(201).json({
        message: 'Category created successfully',
        category,
      });
    } catch (error) {
      console.error('Create Category Error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  },
];

// =============================
// GET ALL CATEGORIES
// =============================
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1 });
    res.json({ categories });
  } catch (error) {
    console.error('Get Categories Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// =============================
// GET SINGLE CATEGORY
// =============================
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ category });
  } catch (error) {
    console.error('Get Category Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// =============================
// UPDATE CATEGORY
// =============================
exports.updateCategory = [
  upload.single('image'),
  async (req, res) => {
    try {
      const { name } = req.body;
      const file = req.file;

      const category = await Category.findById(req.params.id);
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }

      let imageUrl = category.image;

      // Upload new image if provided
      if (file) {
        try {
          // Delete old image
          if (category.image) {
            const publicId = category.image.split('/').pop().split('.')[0];
            await cloudinary.uploader.destroy(publicId);
          }

          // Upload new
          const uploadResult = await uploadToCloudinary(file.buffer, 'categories');
          imageUrl = uploadResult.secure_url;
        } catch (uploadError) {
          console.error('Cloudinary Update Upload Failed:', uploadError);
          return res.status(500).json({ error: 'Image update failed' });
        }
      }

      // Update fields
      category.name = name?.trim() || category.name;
      category.image = imageUrl;

      await category.save();

      res.json({
        message: 'Category updated successfully',
        category,
      });
    } catch (error) {
      console.error('Update Category Error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  },
];

// =============================
// DELETE CATEGORY
// =============================
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Delete image from Cloudinary
    if (category.image) {
      const publicId = category.image.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(publicId).catch(() => {});
    }

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete Category Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};