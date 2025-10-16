const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const BlogPost = require('../models/BlogPost');
const { verifyToken, optionalAuth } = require('../middleware/auth');
const { uploadMultiple, cleanupFiles, handleMulterError } = require('../middleware/upload');
const { uploadMultipleImages, deleteMultipleImages } = require('../config/cloudinary');
const fs = require('fs');

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
  next();
};

/**
 * @route   GET /api/community/posts
 * @desc    Get all blog posts with pagination
 * @access  Public
 */
router.get('/posts', optionalAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sort = 'recent',
      authorId,
      tag
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    let query = { status: 'published' };
    let sortOption = {};

    // Filter by author
    if (authorId) {
      query['author.userId'] = authorId;
    }

    // Filter by tag
    if (tag) {
      query.tags = tag.toLowerCase();
    }

    // Sort options
    switch (sort) {
      case 'popular':
        sortOption = { likesCount: -1, viewsCount: -1 };
        break;
      case 'trending':
        // Posts from last 7 days, sorted by engagement
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        query.createdAt = { $gte: weekAgo };
        sortOption = { likesCount: -1, commentsCount: -1, viewsCount: -1 };
        break;
      case 'recent':
      default:
        sortOption = { createdAt: -1 };
    }

    const posts = await BlogPost.find(query)
      .sort(sortOption)
      .limit(parseInt(limit))
      .skip(skip)
      .select('-comments') // Exclude comments array to reduce payload
      .lean();

    const total = await BlogPost.countDocuments(query);

    // Add liked status if user is authenticated
    const postsWithUserData = posts.map(post => ({
      ...post,
      isLikedByUser: req.user ? post.likes.some(like => like.userId.toString() === req.user.userId.toString()) : false
    }));

    console.log(`📰 Fetched ${posts.length} posts (page ${page}/${Math.ceil(total / limit)})`);

    res.json({
      success: true,
      data: {
        posts: postsWithUserData,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalPosts: total,
          hasMore: skip + posts.length < total
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching posts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching posts',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/community/posts/:id
 * @desc    Get single blog post by ID
 * @access  Public
 */
router.get('/posts/:id', optionalAuth, async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id).lean();

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Increment views (don't await to avoid blocking response)
    BlogPost.findByIdAndUpdate(req.params.id, { $inc: { viewsCount: 1 } }).exec();

    // Add liked status if user is authenticated
    const postWithUserData = {
      ...post,
      isLikedByUser: req.user ? post.likes.some(like => like.userId.toString() === req.user.userId.toString()) : false
    };

    console.log(`📖 Fetched post: ${post.title}`);

    res.json({
      success: true,
      data: postWithUserData
    });
  } catch (error) {
    console.error('❌ Error fetching post:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching post',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/community/posts
 * @desc    Create a new blog post with images
 * @access  Private (travellers and guides)
 */
router.post('/posts',
  verifyToken,
  uploadMultiple,
  handleMulterError,
  parseFormDataFields, // Parse JSON strings from FormData BEFORE validation
  [
    body('title').trim().notEmpty().isLength({ min: 3, max: 200 }).withMessage('Title must be between 3 and 200 characters'),
    body('content').trim().notEmpty().isLength({ min: 10, max: 5000 }).withMessage('Content must be between 10 and 5000 characters'),
    body('tags').optional().isArray().withMessage('Tags must be an array'),
    body('locationName').optional().trim(),
    body('latitude').optional().isFloat().withMessage('Latitude must be a number'),
    body('longitude').optional().isFloat().withMessage('Longitude must be a number')
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        // Clean up uploaded files if validation fails
        if (req.files) {
          cleanupFiles(req.files);
        }
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { title, content, tags, locationName, latitude, longitude } = req.body;

      // Upload images to Cloudinary
      let uploadedImages = [];
      if (req.files && req.files.length > 0) {
        console.log(`📤 Uploading ${req.files.length} images to Cloudinary...`);
        
        const filePaths = req.files.map(file => file.path);
        uploadedImages = await uploadMultipleImages(filePaths);

        // Clean up local files after successful Cloudinary upload
        req.files.forEach(file => {
          fs.unlink(file.path, err => {
            if (err) console.error('Error deleting local file:', err);
          });
        });
      }

      // Create blog post
      // Build location object only if coordinates are valid
      let locationData = undefined;
      if (locationName) {
        locationData = { name: locationName };
        
        // Add coordinates only if both latitude and longitude are valid numbers
        if (latitude && longitude && !isNaN(parseFloat(latitude)) && !isNaN(parseFloat(longitude))) {
          locationData.coordinates = {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude)
          };
        }
      }

      const newPost = new BlogPost({
        author: {
          userId: req.user.userId,
          username: req.user.username,
          avatar: req.user.avatar,
          role: req.user.role
        },
        title,
        content,
        tags: Array.isArray(tags) ? tags : [],
        location: locationData,
        images: uploadedImages,
        status: 'published'
      });

      await newPost.save();

      console.log(`✅ Created new post: ${title} by ${req.user.username}`);

      res.status(201).json({
        success: true,
        message: 'Blog post created successfully',
        data: newPost
      });
    } catch (error) {
      console.error('❌ Error creating post:', error);
      
      // Clean up uploaded files on error
      if (req.files) {
        cleanupFiles(req.files);
      }

      res.status(500).json({
        success: false,
        message: 'Error creating blog post',
        error: error.message
      });
    }
  }
);

/**
 * @route   PUT /api/community/posts/:id
 * @desc    Update a blog post
 * @access  Private (post author only)
 */
router.put('/posts/:id',
  verifyToken,
  [
    body('title').optional().trim().isLength({ min: 3, max: 200 }),
    body('content').optional().trim().isLength({ min: 10, max: 5000 }),
    body('tags').optional().isArray()
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

      const post = await BlogPost.findById(req.params.id);

      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      // Check if user is the author
      if (post.author.userId.toString() !== req.user.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own posts'
        });
      }

      // Update fields
      const { title, content, tags, locationName, latitude, longitude } = req.body;
      
      if (title) post.title = title;
      if (content) post.content = content;
      if (tags) post.tags = tags;
      if (locationName) {
        post.location = {
          name: locationName,
          coordinates: {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude)
          }
        };
      }

      await post.save();

      console.log(`✏️ Updated post: ${post.title}`);

      res.json({
        success: true,
        message: 'Post updated successfully',
        data: post
      });
    } catch (error) {
      console.error('❌ Error updating post:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating post',
        error: error.message
      });
    }
  }
);

/**
 * @route   DELETE /api/community/posts/:id
 * @desc    Delete a blog post and its images from Cloudinary
 * @access  Private (post author only)
 */
router.delete('/posts/:id', verifyToken, async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is the author
    if (post.author.userId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own posts'
      });
    }

    // Delete images from Cloudinary
    if (post.images && post.images.length > 0) {
      console.log(`🗑️ Deleting ${post.images.length} images from Cloudinary...`);
      const publicIds = post.images.map(img => img.publicId);
      await deleteMultipleImages(publicIds);
    }

    // Delete post from database
    await BlogPost.findByIdAndDelete(req.params.id);

    console.log(`✅ Deleted post: ${post.title}`);

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting post:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting post',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/community/posts/:id/like
 * @desc    Like a blog post
 * @access  Private
 */
router.post('/posts/:id/like', verifyToken, async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.addLike(req.user.userId, req.user.username);

    console.log(`❤️ ${req.user.username} liked post: ${post.title}`);

    res.json({
      success: true,
      message: 'Post liked successfully',
      data: {
        likesCount: post.likesCount
      }
    });
  } catch (error) {
    console.error('❌ Error liking post:', error);
    res.status(500).json({
      success: false,
      message: 'Error liking post',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/community/posts/:id/like
 * @desc    Unlike a blog post
 * @access  Private
 */
router.delete('/posts/:id/like', verifyToken, async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.removeLike(req.user.userId);

    console.log(`💔 ${req.user.username} unliked post: ${post.title}`);

    res.json({
      success: true,
      message: 'Post unliked successfully',
      data: {
        likesCount: post.likesCount
      }
    });
  } catch (error) {
    console.error('❌ Error unliking post:', error);
    res.status(500).json({
      success: false,
      message: 'Error unliking post',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/community/posts/:id/comments
 * @desc    Add a comment to a blog post
 * @access  Private
 */
router.post('/posts/:id/comments',
  verifyToken,
  [
    body('content').trim().notEmpty().isLength({ min: 1, max: 500 }).withMessage('Comment must be between 1 and 500 characters')
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

      const post = await BlogPost.findById(req.params.id);

      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      await post.addComment(
        req.user.userId,
        req.user.username,
        req.body.content,
        req.user.avatar
      );

      console.log(`💬 ${req.user.username} commented on post: ${post.title}`);

      res.status(201).json({
        success: true,
        message: 'Comment added successfully',
        data: {
          comment: post.comments[post.comments.length - 1],
          commentsCount: post.commentsCount
        }
      });
    } catch (error) {
      console.error('❌ Error adding comment:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding comment',
        error: error.message
      });
    }
  }
);

/**
 * @route   DELETE /api/community/posts/:id/comments/:commentId
 * @desc    Delete a comment from a blog post
 * @access  Private (comment author only)
 */
router.delete('/posts/:id/comments/:commentId', verifyToken, async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Check if user is the comment author or post author
    if (
      comment.user.userId.toString() !== req.user.userId.toString() &&
      post.author.userId.toString() !== req.user.userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own comments or comments on your posts'
      });
    }

    await post.removeComment(req.params.commentId);

    console.log(`🗑️ Comment deleted from post: ${post.title}`);

    res.json({
      success: true,
      message: 'Comment deleted successfully',
      data: {
        commentsCount: post.commentsCount
      }
    });
  } catch (error) {
    console.error('❌ Error deleting comment:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting comment',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/community/posts/user/:userId
 * @desc    Get all posts by a specific user
 * @access  Public
 */
router.get('/posts/user/:userId', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const posts = await BlogPost.find({
      'author.userId': req.params.userId,
      status: 'published'
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .select('-comments')
      .lean();

    const total = await BlogPost.countDocuments({
      'author.userId': req.params.userId,
      status: 'published'
    });

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalPosts: total,
          hasMore: skip + posts.length < total
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching user posts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user posts',
      error: error.message
    });
  }
});

module.exports = router;
