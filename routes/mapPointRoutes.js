const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const MapPoint = require('../models/MapPoint');
const { verifyToken, optionalAuth } = require('../middleware/auth');
const { uploadMultiple, cleanupFiles, handleMulterError } = require('../middleware/upload');
const { uploadMultipleImages, deleteMultipleImages } = require('../config/cloudinary');

/**
 * Middleware to parse FormData fields that are JSON strings
 */
const parseFormDataFields = (req, res, next) => {
  // Parse tags if it's a JSON string (from FormData)
  if (req.body.tags && typeof req.body.tags === 'string') {
    try {
      req.body.tags = JSON.parse(req.body.tags);
      console.log('✅ Parsed tags:', req.body.tags);
    } catch (e) {
      console.warn('⚠️ Failed to parse tags, treating as single tag');
      req.body.tags = [req.body.tags];
    }
  }

  // Parse coordinates if it's a JSON string
  if (req.body.coordinates && typeof req.body.coordinates === 'string') {
    try {
      req.body.coordinates = JSON.parse(req.body.coordinates);
      console.log('✅ Parsed coordinates:', req.body.coordinates);
    } catch (e) {
      console.error('❌ Failed to parse coordinates');
    }
  }

  // Parse latitude and longitude
  if (req.body.latitude && req.body.longitude) {
    req.body.coordinates = [parseFloat(req.body.longitude), parseFloat(req.body.latitude)];
    console.log('✅ Created coordinates from lat/lng:', req.body.coordinates);
  }

  next();
};

/**
 * @route   POST /api/community/map-points
 * @desc    Create a new map point
 * @access  Private
 */
router.post(
  '/map-points',
  verifyToken,
  uploadMultiple,
  parseFormDataFields,
  [
    body('title')
      .trim()
      .isLength({ min: 3, max: 200 })
      .withMessage('Title must be between 3 and 200 characters'),
    body('description')
      .trim()
      .isLength({ min: 10, max: 2000 })
      .withMessage('Description must be between 10 and 2000 characters'),
    body('category')
      .optional()
      .isIn([
        'attraction',
        'restaurant',
        'hotel',
        'viewpoint',
        'beach',
        'temple',
        'nature',
        'adventure',
        'shopping',
        'nightlife',
        'transport',
        'other'
      ])
      .withMessage('Invalid category')
  ],
  async (req, res) => {
    console.log('\n📍 Creating new map point...');
    console.log('Request body:', req.body);
    console.log('Files:', req.files ? req.files.length : 0);

    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.error('❌ Validation errors:', errors.array());
        if (req.files) cleanupFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const {
        title,
        description,
        coordinates,
        address,
        placeName,
        placeId,
        category,
        tags,
        rating
      } = req.body;

      // Validate coordinates
      if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
        console.error('❌ Invalid coordinates:', coordinates);
        if (req.files) cleanupFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Valid coordinates are required (longitude, latitude)'
        });
      }

      const [longitude, latitude] = coordinates;
      if (isNaN(longitude) || isNaN(latitude)) {
        console.error('❌ Coordinates are not numbers:', coordinates);
        if (req.files) cleanupFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Coordinates must be valid numbers'
        });
      }

      // Upload images to Cloudinary if files are provided
      let images = [];
      if (req.files && req.files.length > 0) {
        console.log(`📤 Uploading ${req.files.length} images to Cloudinary...`);
        const uploadResults = await uploadMultipleImages(req.files);
        images = uploadResults.map(result => ({
          url: result.url,
          publicId: result.publicId,
          thumbnailUrl: result.thumbnailUrl,
          mediumUrl: result.mediumUrl,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes
        }));
        console.log(`✅ Uploaded ${images.length} images successfully`);

        // Cleanup local files
        cleanupFiles(req.files);
      }

      // Create map point
      const mapPoint = new MapPoint({
        author: {
          userId: req.user.userId,
          username: req.user.username,
          avatar: req.user.avatar,
          role: req.user.role || 'traveler'
        },
        title,
        description,
        location: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        address: address || '',
        placeName: placeName || '',
        placeId: placeId || '',
        category: category || 'other',
        tags: tags || [],
        rating: rating ? parseFloat(rating) : 5,
        images,
        status: 'published'
      });

      await mapPoint.save();

      console.log(`✅ Map point created successfully: ${mapPoint._id}`);

      res.status(201).json({
        success: true,
        message: 'Map point created successfully',
        data: mapPoint.toClientJSON(req.user.userId)
      });

    } catch (error) {
      console.error('❌ Error creating map point:', error);
      if (req.files) cleanupFiles(req.files);
      res.status(500).json({
        success: false,
        message: 'Failed to create map point',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /api/community/map-points/popular
 * @desc    Get popular map points
 * @access  Public
 */
router.get('/map-points/popular', optionalAuth, async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const mapPoints = await MapPoint.findPopular(parseInt(limit));

    const mapPointsWithUserData = mapPoints.map(point => 
      point.toClientJSON(req.user ? req.user.userId : null)
    );

    console.log(`📍 Fetched ${mapPoints.length} popular map points`);

    res.json({
      success: true,
      data: {
        mapPoints: mapPointsWithUserData
      }
    });

  } catch (error) {
    console.error('❌ Error fetching popular map points:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch popular map points',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/community/map-points/category/:category
 * @desc    Get map points by category
 * @access  Public
 */
router.get('/map-points/category/:category', optionalAuth, async (req, res) => {
  try {
    const { category } = req.params;
    const { limit = 20 } = req.query;

    const mapPoints = await MapPoint.findByCategory(category, parseInt(limit));

    const mapPointsWithUserData = mapPoints.map(point => 
      point.toClientJSON(req.user ? req.user.userId : null)
    );

    console.log(`📍 Fetched ${mapPoints.length} map points for category: ${category}`);

    res.json({
      success: true,
      data: {
        mapPoints: mapPointsWithUserData,
        category
      }
    });

  } catch (error) {
    console.error('❌ Error fetching map points by category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch map points',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/community/map-points
 * @desc    Get all map points with pagination and filters
 * @access  Public
 */
router.get('/map-points', optionalAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = 'recent',
      category,
      tag,
      authorId,
      latitude,
      longitude,
      maxDistance = 10000 // in meters
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    let query = { status: 'published' };
    let sortOption = {};

    // Filter by category
    if (category) {
      query.category = category;
    }

    // Filter by tag
    if (tag) {
      query.tags = tag.toLowerCase();
    }

    // Filter by author
    if (authorId) {
      query['author.userId'] = authorId;
    }

    // Nearby search
    if (latitude && longitude) {
      console.log(`📍 Finding map points near ${latitude}, ${longitude} (max ${maxDistance}m)`);
      const points = await MapPoint.findNearby(
        parseFloat(longitude),
        parseFloat(latitude),
        parseInt(maxDistance),
        parseInt(limit)
      );

      const total = points.length;
      const pointsWithUserData = points.map(point => 
        point.toClientJSON(req.user ? req.user.userId : null)
      );

      return res.json({
        success: true,
        data: {
          mapPoints: pointsWithUserData,
          pagination: {
            currentPage: parseInt(page),
            totalPages: 1,
            totalItems: total,
            itemsPerPage: parseInt(limit)
          }
        }
      });
    }

    // Sort options
    switch (sort) {
      case 'popular':
        sortOption = { likesCount: -1, createdAt: -1 };
        break;
      case 'rating':
        sortOption = { rating: -1, likesCount: -1 };
        break;
      case 'recent':
      default:
        sortOption = { createdAt: -1 };
    }

    const mapPoints = await MapPoint.find(query)
      .sort(sortOption)
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await MapPoint.countDocuments(query);

    // Add user interaction data if authenticated
    const mapPointsWithUserData = mapPoints.map(point => {
      const mapPointInstance = new MapPoint(point);
      return mapPointInstance.toClientJSON(req.user ? req.user.userId : null);
    });

    console.log(`📍 Fetched ${mapPoints.length} map points (page ${page}/${Math.ceil(total / limit)})`);

    res.json({
      success: true,
      data: {
        mapPoints: mapPointsWithUserData,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching map points:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch map points',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/community/map-points/:id
 * @desc    Get a single map point by ID
 * @access  Public
 */
router.get('/map-points/:id', optionalAuth, async (req, res) => {
  try {
    const mapPoint = await MapPoint.findById(req.params.id);

    if (!mapPoint) {
      return res.status(404).json({
        success: false,
        message: 'Map point not found'
      });
    }

    console.log(`📍 Fetched map point: ${mapPoint._id}`);

    res.json({
      success: true,
      data: mapPoint.toClientJSON(req.user ? req.user.userId : null)
    });

  } catch (error) {
    console.error('❌ Error fetching map point:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch map point',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/community/map-points/:id
 * @desc    Update a map point
 * @access  Private (author only)
 */
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const mapPoint = await MapPoint.findById(req.params.id);

    if (!mapPoint) {
      return res.status(404).json({
        success: false,
        message: 'Map point not found'
      });
    }

    // Check if user is the author
    if (mapPoint.author.userId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this map point'
      });
    }

    const { title, description, category, tags, rating } = req.body;

    if (title) mapPoint.title = title;
    if (description) mapPoint.description = description;
    if (category) mapPoint.category = category;
    if (tags) mapPoint.tags = tags;
    if (rating) mapPoint.rating = rating;

    await mapPoint.save();

    console.log(`✅ Map point updated: ${mapPoint._id}`);

    res.json({
      success: true,
      message: 'Map point updated successfully',
      data: mapPoint.toClientJSON(req.user.userId)
    });

  } catch (error) {
    console.error('❌ Error updating map point:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update map point',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/community/map-points/:id
 * @desc    Delete a map point
 * @access  Private (author only)
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const mapPoint = await MapPoint.findById(req.params.id);

    if (!mapPoint) {
      return res.status(404).json({
        success: false,
        message: 'Map point not found'
      });
    }

    // Check if user is the author
    if (mapPoint.author.userId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this map point'
      });
    }

    // Delete images from Cloudinary
    if (mapPoint.images && mapPoint.images.length > 0) {
      const publicIds = mapPoint.images.map(img => img.publicId);
      await deleteMultipleImages(publicIds);
      console.log(`🗑️ Deleted ${publicIds.length} images from Cloudinary`);
    }

    await mapPoint.deleteOne();

    console.log(`✅ Map point deleted: ${req.params.id}`);

    res.json({
      success: true,
      message: 'Map point deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting map point:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete map point',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/community/map-points/:id/like
 * @desc    Like/unlike a map point
 * @access  Private
 */
router.post('/:id/like', verifyToken, async (req, res) => {
  try {
    const mapPoint = await MapPoint.findById(req.params.id);

    if (!mapPoint) {
      return res.status(404).json({
        success: false,
        message: 'Map point not found'
      });
    }

    const userId = req.user.userId;
    const likeIndex = mapPoint.likes.findIndex(
      like => like.userId.toString() === userId.toString()
    );

    if (likeIndex > -1) {
      // Unlike
      mapPoint.likes.splice(likeIndex, 1);
      mapPoint.likesCount = mapPoint.likes.length;
      await mapPoint.save();

      console.log(`👎 User ${userId} unliked map point ${mapPoint._id}`);

      return res.json({
        success: true,
        message: 'Map point unliked',
        data: {
          liked: false,
          likesCount: mapPoint.likesCount
        }
      });
    } else {
      // Like
      mapPoint.likes.push({ userId });
      mapPoint.likesCount = mapPoint.likes.length;
      await mapPoint.save();

      console.log(`👍 User ${userId} liked map point ${mapPoint._id}`);

      return res.json({
        success: true,
        message: 'Map point liked',
        data: {
          liked: true,
          likesCount: mapPoint.likesCount
        }
      });
    }

  } catch (error) {
    console.error('❌ Error liking map point:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like map point',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/community/map-points/:id/save
 * @desc    Save/unsave a map point
 * @access  Private
 */
router.post('/:id/save', verifyToken, async (req, res) => {
  try {
    const mapPoint = await MapPoint.findById(req.params.id);

    if (!mapPoint) {
      return res.status(404).json({
        success: false,
        message: 'Map point not found'
      });
    }

    const userId = req.user.userId;
    const saveIndex = mapPoint.saves.findIndex(
      save => save.userId.toString() === userId.toString()
    );

    if (saveIndex > -1) {
      // Unsave
      mapPoint.saves.splice(saveIndex, 1);
      mapPoint.savesCount = mapPoint.saves.length;
      await mapPoint.save();

      console.log(`🔖 User ${userId} unsaved map point ${mapPoint._id}`);

      return res.json({
        success: true,
        message: 'Map point unsaved',
        data: {
          saved: false,
          savesCount: mapPoint.savesCount
        }
      });
    } else {
      // Save
      mapPoint.saves.push({ userId });
      mapPoint.savesCount = mapPoint.saves.length;
      await mapPoint.save();

      console.log(`🔖 User ${userId} saved map point ${mapPoint._id}`);

      return res.json({
        success: true,
        message: 'Map point saved',
        data: {
          saved: true,
          savesCount: mapPoint.savesCount
        }
      });
    }

  } catch (error) {
    console.error('❌ Error saving map point:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save map point',
      error: error.message
    });
  }
});

module.exports = router;
