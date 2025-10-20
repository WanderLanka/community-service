const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const MapPoint = require('../models/MapPoint');
const { body, param, query, validationResult } = require('express-validator');
const { verifyToken: auth } = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const { uploadMultiple, cleanupFiles: cleanupUploadedFiles } = require('../middleware/upload');
const { uploadImage, deleteImage } = require('../config/cloudinary');

// Helper function to clean up uploaded files on error
const cleanupFiles = async (files) => {
  if (files && files.length > 0) {
    console.log('🧹 Cleaning up uploaded files...');
    // Clean up local files
    cleanupUploadedFiles(files);
  }
};

/**
 * @route   POST /map-points/:mapPointId/reviews
 * @desc    Create a review for a map point
 * @access  Private
 */
router.post(
  '/map-points/:mapPointId/reviews',
  auth,
  uploadMultiple, // Max 5 images per review
  [
    param('mapPointId').isMongoId().withMessage('Invalid map point ID'),
    body('rating')
      .isInt({ min: 1, max: 5 })
      .withMessage('Rating must be between 1 and 5'),
    body('comment')
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Comment must be between 10 and 1000 characters'),
    body('visitDate')
      .optional()
      .isISO8601()
      .withMessage('Visit date must be a valid date')
  ],
  async (req, res) => {
    console.log('\n📝 Creating review for map point...');
    console.log('Map Point ID:', req.params.mapPointId);
    console.log('Request body:', req.body);
    console.log('Files:', req.files ? req.files.length : 0);

    try {
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

      const { mapPointId } = req.params;
      const { rating, comment, visitDate } = req.body;

      // Check if map point exists
      const mapPoint = await MapPoint.findById(mapPointId);
      if (!mapPoint) {
        console.error('❌ Map point not found:', mapPointId);
        if (req.files) cleanupFiles(req.files);
        return res.status(404).json({
          success: false,
          message: 'Map point not found'
        });
      }

      // Check if user already reviewed this map point
      const existingReview = await Review.findOne({
        mapPoint: mapPointId,
        'author.userId': req.user.userId
      });

      if (existingReview) {
        console.error('❌ User already reviewed this map point');
        if (req.files) cleanupFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'You have already reviewed this map point. Please edit your existing review instead.'
        });
      }

      // Process uploaded images - upload to Cloudinary
      const images = [];
      if (req.files && req.files.length > 0) {
        try {
          for (const file of req.files) {
            const uploadResult = await uploadImage(file.path, 'wanderlanka/reviews');
            images.push({
              url: uploadResult.url,
              publicId: uploadResult.publicId,
              thumbnailUrl: uploadResult.thumbnailUrl
            });
          }
          // Clean up local files after uploading to Cloudinary
          cleanupUploadedFiles(req.files);
        } catch (uploadError) {
          console.error('❌ Error uploading images to Cloudinary:', uploadError);
          // Clean up local files
          cleanupUploadedFiles(req.files);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload images',
            error: uploadError.message
          });
        }
      }

      // Create review
      const review = new Review({
        mapPoint: mapPointId,
        author: {
          userId: req.user.userId,
          username: req.user.username,
          avatar: req.user.avatar,
          role: req.user.role || 'traveler'
        },
        rating: parseInt(rating),
        comment: comment.trim(),
        images,
        visitDate: visitDate ? new Date(visitDate) : undefined,
        status: 'published'
      });

      await review.save();

      console.log('✅ Review created successfully:', review._id);

      res.status(201).json({
        success: true,
        message: 'Review created successfully',
        data: review.toClientJSON(req.user.userId)
      });

    } catch (error) {
      console.error('❌ Error creating review:', error);
      if (req.files) cleanupFiles(req.files);
      
      res.status(500).json({
        success: false,
        message: 'Failed to create review',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /map-points/:mapPointId/reviews
 * @desc    Get reviews for a map point
 * @access  Public (with optional auth for user-specific data)
 */
router.get(
  '/map-points/:mapPointId/reviews',
  optionalAuth,
  [
    param('mapPointId').isMongoId().withMessage('Invalid map point ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
    query('sort').optional().isIn(['recent', 'helpful', 'rating']).withMessage('Invalid sort option'),
    query('minRating').optional().isInt({ min: 1, max: 5 }).withMessage('Min rating must be between 1 and 5')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { mapPointId } = req.params;
      const {
        page = 1,
        limit = 10,
        sort = 'recent',
        minRating = 1
      } = req.query;

      // Check if map point exists
      const mapPoint = await MapPoint.findById(mapPointId);
      if (!mapPoint) {
        return res.status(404).json({
          success: false,
          message: 'Map point not found'
        });
      }

      // Get reviews
      const result = await Review.getMapPointReviews(mapPointId, {
        page: parseInt(page),
        limit: parseInt(limit),
        sort,
        minRating: parseInt(minRating)
      });

      // Convert to client JSON with user-specific data
      const userId = req.user ? req.user.userId : null;
      const reviewsWithUserData = result.reviews.map(review => {
        const reviewInstance = new Review(review);
        return reviewInstance.toClientJSON(userId);
      });

      // Get rating statistics
      const stats = await Review.calculateAverageRating(mapPointId);

      console.log(`📊 Fetched ${reviewsWithUserData.length} reviews for map point ${mapPointId}`);

      res.json({
        success: true,
        data: {
          reviews: reviewsWithUserData,
          pagination: result.pagination,
          stats
        }
      });

    } catch (error) {
      console.error('❌ Error fetching reviews:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch reviews',
        error: error.message
      });
    }
  }
);

/**
 * @route   PUT /reviews/:reviewId
 * @desc    Update a review
 * @access  Private (author only)
 */
router.put(
  '/reviews/:reviewId',
  auth,
  [
    param('reviewId').isMongoId().withMessage('Invalid review ID'),
    body('rating')
      .optional()
      .isInt({ min: 1, max: 5 })
      .withMessage('Rating must be between 1 and 5'),
    body('comment')
      .optional()
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Comment must be between 10 and 1000 characters')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { reviewId } = req.params;
      const { rating, comment } = req.body;

      // Find review
      const review = await Review.findById(reviewId);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found'
        });
      }

      // Check if user is the author
      if (review.author.userId.toString() !== req.user.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own reviews'
        });
      }

      // Update fields
      if (rating) review.rating = parseInt(rating);
      if (comment) review.comment = comment.trim();
      review.edited = true;
      review.editedAt = new Date();

      await review.save();

      console.log('✅ Review updated successfully:', reviewId);

      res.json({
        success: true,
        message: 'Review updated successfully',
        data: review.toClientJSON(req.user.userId)
      });

    } catch (error) {
      console.error('❌ Error updating review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update review',
        error: error.message
      });
    }
  }
);

/**
 * @route   DELETE /reviews/:reviewId
 * @desc    Delete a review
 * @access  Private (author only)
 */
router.delete(
  '/reviews/:reviewId',
  auth,
  [
    param('reviewId').isMongoId().withMessage('Invalid review ID')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { reviewId } = req.params;

      // Find review
      const review = await Review.findById(reviewId);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found'
        });
      }

      // Check if user is the author
      if (review.author.userId.toString() !== req.user.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own reviews'
        });
      }

      // Delete review
      await Review.findByIdAndDelete(reviewId);

      console.log('✅ Review deleted successfully:', reviewId);

      res.json({
        success: true,
        message: 'Review deleted successfully'
      });

    } catch (error) {
      console.error('❌ Error deleting review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete review',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /reviews/:reviewId/helpful
 * @desc    Mark/unmark review as helpful
 * @access  Private
 */
router.post(
  '/reviews/:reviewId/helpful',
  auth,
  [
    param('reviewId').isMongoId().withMessage('Invalid review ID')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { reviewId } = req.params;

      // Find review
      const review = await Review.findById(reviewId);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found'
        });
      }

      // Check if already marked as helpful
      const isHelpful = review.helpful.some(
        h => h.userId.toString() === req.user.userId.toString()
      );

      if (isHelpful) {
        await review.unmarkHelpful(req.user.userId);
        console.log('👎 Review unmarked as helpful');
      } else {
        await review.markHelpful(req.user.userId);
        console.log('👍 Review marked as helpful');
      }

      res.json({
        success: true,
        message: isHelpful ? 'Review unmarked as helpful' : 'Review marked as helpful',
        data: {
          isHelpful: !isHelpful,
          helpfulCount: review.helpfulCount
        }
      });

    } catch (error) {
      console.error('❌ Error toggling helpful:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to toggle helpful status',
        error: error.message
      });
    }
  }
);

module.exports = router;
