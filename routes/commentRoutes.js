const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const Comment = require('../models/Comment');
const BlogPost = require('../models/BlogPost');
const { verifyToken: auth, optionalAuth } = require('../middleware/auth');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false, 
      errors: errors.array() 
    });
  }
  next();
};

/**
 * @route   GET /api/community/posts/:postId/comments
 * @desc    Get comments for a post with nested replies
 * @access  Public
 */
router.get(
  '/posts/:postId/comments',
  optionalAuth,
  [
    param('postId').isMongoId().withMessage('Invalid post ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
  ],
  validate,
  async (req, res) => {
    try {
      const { postId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const userId = req.user?.userId || null;

      // Check if post exists
      const post = await BlogPost.findById(postId);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      // Get comments with nested replies
      const comments = await Comment.getCommentsWithReplies(postId, {
        page,
        limit,
        userId
      });

      // Get total count for pagination
      const totalComments = await Comment.getCommentCount(postId);

      res.json({
        success: true,
        data: {
          comments,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalComments / limit),
            totalComments,
            hasMore: page * limit < totalComments
          }
        }
      });
    } catch (error) {
      console.error('Error fetching comments:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching comments',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /api/community/comments/:commentId/replies
 * @desc    Get replies for a specific comment
 * @access  Public
 */
router.get(
  '/comments/:commentId/replies',
  optionalAuth,
  [
    param('commentId').isMongoId().withMessage('Invalid comment ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
  ],
  validate,
  async (req, res) => {
    try {
      const { commentId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const userId = req.user?.userId || null;

      // Check if comment exists
      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Comment not found'
        });
      }

      // Get replies
      const replies = await Comment.getRepliesForComment(commentId, {
        page,
        limit,
        userId
      });

      res.json({
        success: true,
        data: {
          replies,
          pagination: {
            currentPage: page,
            totalReplies: comment.repliesCount,
            hasMore: page * limit < comment.repliesCount
          }
        }
      });
    } catch (error) {
      console.error('Error fetching replies:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching replies',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /api/community/posts/:postId/comments
 * @desc    Add a comment to a post
 * @access  Private
 */
router.post(
  '/posts/:postId/comments',
  auth,
  [
    param('postId').isMongoId().withMessage('Invalid post ID'),
    body('content')
      .trim()
      .notEmpty().withMessage('Comment content is required')
      .isLength({ max: 1000 }).withMessage('Comment must be less than 1000 characters'),
    body('parentCommentId')
      .optional()
      .isMongoId().withMessage('Invalid parent comment ID')
  ],
  validate,
  async (req, res) => {
    try {
      const { postId } = req.params;
      const { content, parentCommentId } = req.body;
      const userId = req.user.userId;

      // Check if post exists and allows comments
      const post = await BlogPost.findById(postId);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      if (!post.settings.allowComments) {
        return res.status(403).json({
          success: false,
          message: 'Comments are disabled for this post'
        });
      }

      let level = 0;
      let parentComment = null;

      // If replying to a comment, validate parent comment
      if (parentCommentId) {
        parentComment = await Comment.findById(parentCommentId);
        if (!parentComment) {
          return res.status(404).json({
            success: false,
            message: 'Parent comment not found'
          });
        }

        // Check if parent comment belongs to the same post
        if (parentComment.post.toString() !== postId) {
          return res.status(400).json({
            success: false,
            message: 'Parent comment does not belong to this post'
          });
        }

        // Set level (limit nesting)
        level = Math.min(parentComment.level + 1, 10);
      }

      // Create comment
      const comment = new Comment({
        post: postId,
        author: {
          userId: userId,
          username: req.user.username,
          profilePicture: req.user.avatar || req.user.profilePicture || null
        },
        content,
        parentComment: parentCommentId || null,
        level
      });

      console.log('💾 Saving comment:', JSON.stringify(comment.toObject(), null, 2));

      await comment.save();

      console.log('✅ Comment saved:', JSON.stringify(comment.toObject(), null, 2));

      // Update post's comment count
      await post.incrementCommentsCount();

      res.status(201).json({
        success: true,
        data: {
          comment: {
            ...comment.toObject(),
            isLikedByUser: false,
            replies: []
          }
        },
        message: 'Comment added successfully'
      });
    } catch (error) {
      console.error('Error adding comment:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding comment',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /api/community/comments/:commentId/like
 * @desc    Like a comment
 * @access  Private
 */
router.post(
  '/comments/:commentId/like',
  auth,
  [
    param('commentId').isMongoId().withMessage('Invalid comment ID')
  ],
  validate,
  async (req, res) => {
    try {
      const { commentId } = req.params;
      const userId = req.user.userId;

      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Comment not found'
        });
      }

      // Check if already liked
      if (comment.isLikedBy(userId)) {
        return res.status(400).json({
          success: false,
          message: 'Comment already liked'
        });
      }

      await comment.addLike(userId);

      res.json({
        success: true,
        data: {
          likesCount: comment.likesCount,
          isLikedByUser: true
        },
        message: 'Comment liked successfully'
      });
    } catch (error) {
      console.error('Error liking comment:', error);
      res.status(500).json({
        success: false,
        message: 'Error liking comment',
        error: error.message
      });
    }
  }
);

/**
 * @route   DELETE /api/community/comments/:commentId/like
 * @desc    Unlike a comment
 * @access  Private
 */
router.delete(
  '/comments/:commentId/like',
  auth,
  [
    param('commentId').isMongoId().withMessage('Invalid comment ID')
  ],
  validate,
  async (req, res) => {
    try {
      const { commentId } = req.params;
      const userId = req.user.userId;

      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Comment not found'
        });
      }

      // Check if not liked
      if (!comment.isLikedBy(userId)) {
        return res.status(400).json({
          success: false,
          message: 'Comment not liked yet'
        });
      }

      await comment.removeLike(userId);

      res.json({
        success: true,
        data: {
          likesCount: comment.likesCount,
          isLikedByUser: false
        },
        message: 'Comment unliked successfully'
      });
    } catch (error) {
      console.error('Error unliking comment:', error);
      res.status(500).json({
        success: false,
        message: 'Error unliking comment',
        error: error.message
      });
    }
  }
);

/**
 * @route   DELETE /api/community/comments/:commentId
 * @desc    Delete a comment (soft delete)
 * @access  Private
 */
router.delete(
  '/comments/:commentId',
  auth,
  [
    param('commentId').isMongoId().withMessage('Invalid comment ID')
  ],
  validate,
  async (req, res) => {
    try {
      const { commentId } = req.params;
      const userId = req.user.userId;

      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Comment not found'
        });
      }

      // Check if user is the author or post owner
      const post = await BlogPost.findById(comment.post);
      const isAuthor = comment.author.userId.toString() === userId;
      const isPostOwner = post && post.author.userId.toString() === userId;

      if (!isAuthor && !isPostOwner) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this comment'
        });
      }

      // Soft delete
      await comment.softDelete();

      // Update post's comment count
      if (post) {
        await post.decrementCommentsCount();
      }

      res.json({
        success: true,
        message: 'Comment deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting comment:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting comment',
        error: error.message
      });
    }
  }
);

module.exports = router;
