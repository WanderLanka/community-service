const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { Report, REPORT_REASONS } = require('../models/Report');
const BlogPost = require('../models/BlogPost');
const { verifyToken } = require('../middleware/auth');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

/**
 * @route   POST /api/community/posts/:postId/hide
 * @desc    Hide a post from user's feed
 * @access  Private
 */
router.post(
  '/posts/:postId/hide',
  verifyToken,
  [
    param('postId').isMongoId().withMessage('Invalid post ID')
  ],
  validate,
  async (req, res) => {
    try {
      const { postId } = req.params;
      const userId = req.user.userId;

      const post = await BlogPost.findById(postId);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      // Can't hide your own post
      if (post.author.userId.toString() === userId.toString()) {
        return res.status(400).json({
          success: false,
          message: 'You cannot hide your own post'
        });
      }

      // Check if already hidden
      if (post.isHiddenForUser(userId)) {
        return res.status(400).json({
          success: false,
          message: 'Post is already hidden'
        });
      }

      await post.hideForUser(userId);

      console.log(`🙈 ${req.user.username} hid post: ${post.title}`);

      res.json({
        success: true,
        message: 'Post hidden successfully',
        data: {
          postId: post._id,
          hiddenBy: post.hiddenBy.length
        }
      });
    } catch (error) {
      console.error('Error hiding post:', error);
      res.status(500).json({
        success: false,
        message: 'Error hiding post',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /api/community/posts/:postId/unhide
 * @desc    Unhide a post (restore to user's feed)
 * @access  Private
 */
router.post(
  '/posts/:postId/unhide',
  verifyToken,
  [
    param('postId').isMongoId().withMessage('Invalid post ID')
  ],
  validate,
  async (req, res) => {
    try {
      const { postId } = req.params;
      const userId = req.user.userId;

      const post = await BlogPost.findById(postId);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      // Check if post is hidden
      if (!post.isHiddenForUser(userId)) {
        return res.status(400).json({
          success: false,
          message: 'Post is not hidden'
        });
      }

      await post.unhideForUser(userId);

      console.log(`👁️ ${req.user.username} unhid post: ${post.title}`);

      res.json({
        success: true,
        message: 'Post unhidden successfully',
        data: {
          postId: post._id
        }
      });
    } catch (error) {
      console.error('Error unhiding post:', error);
      res.status(500).json({
        success: false,
        message: 'Error unhiding post',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /api/community/posts/:postId/report
 * @desc    Report a post with weighted scoring
 * @access  Private
 */
router.post(
  '/posts/:postId/report',
  verifyToken,
  [
    param('postId').isMongoId().withMessage('Invalid post ID'),
    body('reason')
      .isIn(Object.keys(REPORT_REASONS))
      .withMessage('Invalid report reason'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must be less than 500 characters')
  ],
  validate,
  async (req, res) => {
    try {
      const { postId } = req.params;
      const { reason, description } = req.body;
      const userId = req.user.userId;

      // Check if post exists
      const post = await BlogPost.findById(postId);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      // Can't report your own post
      if (post.author.userId.toString() === userId.toString()) {
        return res.status(400).json({
          success: false,
          message: 'You cannot report your own post'
        });
      }

      // Check if user already reported this post
      const existingReport = await Report.findOne({
        post: postId,
        'reporter.userId': userId
      });

      if (existingReport) {
        return res.status(400).json({
          success: false,
          message: 'You have already reported this post'
        });
      }

      // Calculate weights
      const reasonWeight = REPORT_REASONS[reason].weight;
      const credibilityWeight = Report.calculateCredibilityWeight(
        req.user.createdAt || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default to 30 days ago if not provided
        req.user.isVerified || false
      );

      const weightedScore = reasonWeight * credibilityWeight;

      // Create report
      const report = new Report({
        post: postId,
        reporter: {
          userId: userId,
          username: req.user.username,
          accountCreatedAt: req.user.createdAt || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          isVerified: req.user.isVerified || false
        },
        reason,
        reasonLabel: REPORT_REASONS[reason].label,
        description: description || '',
        reasonWeight,
        credibilityWeight,
        weightedScore
      });

      await report.save();

      // Update post report stats
      await post.addReport(weightedScore);

      console.log(`🚨 ${req.user.username} reported post: ${post.title}`);
      console.log(`   Reason: ${REPORT_REASONS[reason].label}`);
      console.log(`   Weighted Score: ${weightedScore.toFixed(2)} (reason: ${reasonWeight}, credibility: ${credibilityWeight})`);

      // Check if post should be auto-flagged
      const autoFlagResult = await Report.shouldAutoFlag(postId);
      
      if (autoFlagResult.shouldFlag && !post.isFlagged) {
        await post.flagPost(autoFlagResult.severity, autoFlagResult.reason);
        
        console.log(`🚩 POST AUTO-FLAGGED!`);
        console.log(`   Severity: ${autoFlagResult.severity}`);
        console.log(`   Reason: ${autoFlagResult.reason}`);
        
        // TODO: Send notification to admins
        // TODO: Optionally auto-hide post for all users if severity is 'critical'
      }

      res.status(201).json({
        success: true,
        message: 'Report submitted successfully',
        data: {
          report: {
            _id: report._id,
            reason: report.reasonLabel,
            weightedScore: report.weightedScore,
            status: report.status
          },
          post: {
            reportCount: post.reportCount,
            totalReportScore: post.totalReportScore,
            isFlagged: post.isFlagged,
            flagSeverity: post.flagSeverity
          },
          autoFlagged: autoFlagResult.shouldFlag
        }
      });
    } catch (error) {
      console.error('Error reporting post:', error);
      res.status(500).json({
        success: false,
        message: 'Error reporting post',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /api/community/posts/:postId/reports
 * @desc    Get reports for a post (admin only)
 * @access  Private (Admin)
 */
router.get(
  '/posts/:postId/reports',
  verifyToken,
  [
    param('postId').isMongoId().withMessage('Invalid post ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  validate,
  async (req, res) => {
    try {
      const { postId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      // TODO: Add admin check
      // if (req.user.role !== 'admin') {
      //   return res.status(403).json({ success: false, message: 'Admin access required' });
      // }

      const post = await BlogPost.findById(postId);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      const reports = await Report.find({ post: postId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalReports = await Report.countDocuments({ post: postId });
      const stats = await Report.getPostReportStats(postId);

      res.json({
        success: true,
        data: {
          reports,
          post: {
            _id: post._id,
            title: post.title,
            author: post.author,
            reportCount: post.reportCount,
            totalReportScore: post.totalReportScore,
            isFlagged: post.isFlagged,
            flagSeverity: post.flagSeverity,
            flagReason: post.flagReason,
            flaggedAt: post.flaggedAt
          },
          stats,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalReports / limit),
            totalReports,
            hasMore: page * limit < totalReports
          }
        }
      });
    } catch (error) {
      console.error('Error fetching reports:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching reports',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /api/community/reports/reasons
 * @desc    Get list of available report reasons
 * @access  Public
 */
router.get('/reports/reasons', (req, res) => {
  const reasons = Object.entries(REPORT_REASONS).map(([key, value]) => ({
    key,
    label: value.label,
    weight: value.weight
  }));

  res.json({
    success: true,
    data: { reasons }
  });
});

module.exports = router;
