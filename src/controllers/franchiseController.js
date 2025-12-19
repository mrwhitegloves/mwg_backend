// controllers/franchiseController.js
const Franchise = require('../models/Franchise');
const AdminUser = require('../models/AdminUser'); // assuming this exists

// CREATE FRANCHISE
exports.createFranchise = async (req, res) => {
  try {
    const {
      name, description, address, Location, serviceArea, contact,
      operatingHours, isActive, owner, services
    } = req.body;

    if (!name || !address?.city || !address?.state || !owner) {
      return res.status(400).json({ error: 'Name, city, state, and owner are required' });
    }

    // Validate owner is franchiseAdmin
    const admin = await AdminUser.findById(owner);
    if (!admin || admin.role !== 'franchiseAdmin') {
      return res.status(400).json({ error: 'Owner must be a franchiseAdmin' });
    }

    const franchise = new Franchise({
      name, description, address, Location, serviceArea, contact,
      operatingHours, isActive, owner, services: services || []
    });

    await franchise.save();

    const populated = await Franchise.findById(franchise._id)
      .populate('owner', 'name email')
      .populate('services', 'name')
      .populate('partners', 'name email phone');

    res.status(201).json({ message: 'Franchise created', franchise: populated });
  } catch (error) {
    console.error('Create Franchise Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET ALL FRANCHISES (with filters & pagination)
exports.getFranchises = async (req, res) => {
  try {
    const {
      page = 1, limit = 10, search = '', city = '', state = '', isActive = 'true'
    } = req.query;

    const filter = { isActive: isActive === 'true' };
    if (city) filter['address.city'] = { $regex: city, $options: 'i' };
    if (state) filter['address.state'] = { $regex: state, $options: 'i' };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { 'contact.email': { $regex: search, $options: 'i' } },
        { 'contact.phone': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [franchises, total] = await Promise.all([
      Franchise.find(filter)
        .populate('owner', 'name email')
        .populate('services', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Franchise.countDocuments(filter)
    ]);

    res.json({
      franchises,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get Franchises Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET SINGLE FRANCHISE
exports.getFranchiseById = async (req, res) => {
  try {
    const franchise = await Franchise.findById(req.params.id)
      .populate('owner', 'name email')
      .populate('services', 'name')
      .populate('partners', 'name email phone');

    if (!franchise) return res.status(404).json({ error: 'Franchise not found' });

    res.json(franchise);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// UPDATE FRANCHISE
exports.updateFranchise = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    if (updateData.owner) {
      const admin = await AdminUser.findById(updateData.owner);
      if (!admin || admin.role !== 'franchiseAdmin') {
        return res.status(400).json({ error: 'Owner must be a franchiseAdmin' });
      }
    }

    if (updateData.serviceArea?.pincodes) {
      updateData.serviceArea.pincodes = updateData.serviceArea.pincodes
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);
    }

    const franchise = await Franchise.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('owner', 'name email')
      .populate('services', 'name')
      .populate('partners', 'name email phone');

    if (!franchise) return res.status(404).json({ error: 'Franchise not found' });

    res.json({ message: 'Franchise updated', franchise });
  } catch (error) {
    console.error('Update Franchise Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE FRANCHISE
exports.deleteFranchise = async (req, res) => {
  try {
    const franchise = await Franchise.findByIdAndDelete(req.params.id);
    if (!franchise) return res.status(404).json({ error: 'Franchise not found' });
    res.json({ message: 'Franchise deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// CHECK FRANCHISE AVAILABILITY BY PINCODE
exports.checkAvailability = async (req, res) => {
  try {
    const { pincode } = req.query;

    if (!pincode || pincode.toString().length !== 6) {
      return res.status(400).json({ error: 'Valid 6-digit pincode is required' });
    }

    const franchise = await Franchise.findOne({
      'serviceArea.pincodes': pincode.toString(),
      isActive: true,
    })
      .populate('owner', 'name email')
      .populate('services', 'name price')
      .populate('partners', 'name email phone');

    if (!franchise) {
      return res.json({ available: false });
    }

    res.json({
      available: true,
      franchise: {
        _id: franchise._id,
        name: franchise.name,
        address: franchise.address,
        contact: franchise.contact,
        services: franchise.services,
        partnersCount: franchise.partners.length,
      },
    });
  } catch (error) {
    console.error('Check Availability Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};