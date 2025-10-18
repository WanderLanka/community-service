const mongoose = require('mongoose');

// Report reasons with their severity weights
const REPORT_REASONS = {
  SPAM: { label: 'Spam', weight: 1.0 },
  INAPPROPRIATE_CONTENT: { label: 'Inappropriate Content', weight: 1.5 },
  HARASSMENT: { label: 'Harassment or Bullying', weight: 2.0 },
  MISINFORMATION: { label: 'Misinformation', weight: 1.8 },
  SCAM_OR_FRAUD: { label: 'Scam or Fraud', weight: 2.5 },
  HATE_SPEECH: { label: 'Hate Speech', weight: 2.8 },
  VIOLENCE: { label: 'Violence or Dangerous Content', weight: 3.0 },
  COPYRIGHT: { label: 'Copyright Violation', weight: 1.2 },
  OTHER: { label: 'Other', weight: 1.0 }
};

// User credibility tiers based on account age and activity
const CREDIBILITY_TIERS = {
  NEW_USER: { minDays: 0, maxDays: 7, weight: 0.5 },        // New accounts (< 7 days)
  REGULAR_USER: { minDays: 7, maxDays: 30, weight: 1.0 },   // Regular users (7-30 days)
  TRUSTED_USER: { minDays: 30, maxDays: 90, weight: 1.5 },  // Trusted (30-90 days)
  VETERAN_USER: { minDays: 90, maxDays: null, weight: 2.0 } // Veterans (90+ days)
};

const reportSchema = new mongoose.Schema(
  {
    // Reference to the reported post
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BlogPost',
      required: true,
      index: true
    },

    // Reporter information (denormalized for microservices)
    reporter: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
      },
      username: {
        type: String,
        required: true
      },
      accountCreatedAt: {
        type: Date,
        required: true
      },
      // Verified users get higher credibility
      isVerified: {
        type: Boolean,
        default: false
      }
    },

    // Report details
    reason: {
      type: String,
      enum: Object.keys(REPORT_REASONS),
      required: true,
      index: true
    },
    
    reasonLabel: {
      type: String,
      required: true
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500
    },

    // Weights and scores
    reasonWeight: {
      type: Number,
      required: true,
      min: 0
    },

    credibilityWeight: {
      type: Number,
      required: true,
      min: 0
    },

    // Total weighted score for this report
    weightedScore: {
      type: Number,
      required: true,
      min: 0,
      index: true
    },

    // Report status
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'dismissed', 'action_taken'],
      default: 'pending',
      index: true
    },

    // Admin review
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },

    reviewedAt: {
      type: Date,
      default: null
    },

    reviewNotes: {
      type: String,
      maxlength: 1000
    },

    // Action taken
    actionTaken: {
      type: String,
      enum: ['none', 'warned', 'post_hidden', 'post_removed', 'user_suspended'],
      default: 'none'
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
reportSchema.index({ post: 1, createdAt: -1 });
reportSchema.index({ post: 1, status: 1 });
reportSchema.index({ 'reporter.userId': 1, createdAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });

// Static method to calculate user credibility weight
reportSchema.statics.calculateCredibilityWeight = function(accountCreatedAt, isVerified) {
  const now = new Date();
  const accountAge = Math.floor((now - new Date(accountCreatedAt)) / (1000 * 60 * 60 * 24)); // days

  let credibilityWeight = 1.0;

  // Determine tier based on account age
  if (accountAge < CREDIBILITY_TIERS.NEW_USER.maxDays) {
    credibilityWeight = CREDIBILITY_TIERS.NEW_USER.weight;
  } else if (accountAge < CREDIBILITY_TIERS.REGULAR_USER.maxDays) {
    credibilityWeight = CREDIBILITY_TIERS.REGULAR_USER.weight;
  } else if (accountAge < CREDIBILITY_TIERS.TRUSTED_USER.maxDays) {
    credibilityWeight = CREDIBILITY_TIERS.TRUSTED_USER.weight;
  } else {
    credibilityWeight = CREDIBILITY_TIERS.VETERAN_USER.weight;
  }

  // Boost credibility for verified users
  if (isVerified) {
    credibilityWeight *= 1.5;
  }

  return credibilityWeight;
};

// Static method to get report statistics for a post
reportSchema.statics.getPostReportStats = async function(postId, timeWindowHours = null) {
  const match = {
    post: new mongoose.Types.ObjectId(postId),
    status: { $in: ['pending', 'reviewed'] }
  };

  // Apply time window filter if specified
  if (timeWindowHours) {
    const cutoffTime = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);
    match.createdAt = { $gte: cutoffTime };
  }

  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$post',
        totalReports: { $sum: 1 },
        totalWeightedScore: { $sum: '$weightedScore' },
        avgWeightedScore: { $avg: '$weightedScore' },
        reasons: { $push: '$reason' },
        firstReportAt: { $min: '$createdAt' },
        lastReportAt: { $max: '$createdAt' }
      }
    }
  ]);

  return stats.length > 0 ? stats[0] : null;
};

// Static method to check if post should be auto-flagged
reportSchema.statics.shouldAutoFlag = async function(postId) {
  // Thresholds
  const IMMEDIATE_THRESHOLD = 15;    // High-priority reports in short time
  const MODERATE_THRESHOLD = 30;     // Medium-priority reports
  const LOW_THRESHOLD = 50;          // Low-priority reports

  const IMMEDIATE_WINDOW = 1;        // 1 hour
  const MODERATE_WINDOW = 24;        // 24 hours
  const LOW_WINDOW = 168;            // 7 days

  // Check immediate window (1 hour)
  const immediateStats = await this.getPostReportStats(postId, IMMEDIATE_WINDOW);
  if (immediateStats && immediateStats.totalWeightedScore >= IMMEDIATE_THRESHOLD) {
    return {
      shouldFlag: true,
      severity: 'critical',
      reason: `${immediateStats.totalReports} reports with weighted score ${immediateStats.totalWeightedScore.toFixed(2)} in ${IMMEDIATE_WINDOW}h`,
      stats: immediateStats
    };
  }

  // Check moderate window (24 hours)
  const moderateStats = await this.getPostReportStats(postId, MODERATE_WINDOW);
  if (moderateStats && moderateStats.totalWeightedScore >= MODERATE_THRESHOLD) {
    return {
      shouldFlag: true,
      severity: 'high',
      reason: `${moderateStats.totalReports} reports with weighted score ${moderateStats.totalWeightedScore.toFixed(2)} in ${MODERATE_WINDOW}h`,
      stats: moderateStats
    };
  }

  // Check low window (7 days)
  const lowStats = await this.getPostReportStats(postId, LOW_WINDOW);
  if (lowStats && lowStats.totalWeightedScore >= LOW_THRESHOLD) {
    return {
      shouldFlag: true,
      severity: 'moderate',
      reason: `${lowStats.totalReports} reports with weighted score ${lowStats.totalWeightedScore.toFixed(2)} in ${LOW_WINDOW}h`,
      stats: lowStats
    };
  }

  return {
    shouldFlag: false,
    severity: 'none',
    stats: lowStats || immediateStats || moderateStats
  };
};

// Instance method to update report status
reportSchema.methods.review = function(adminId, action, notes) {
  this.status = 'reviewed';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.actionTaken = action;
  this.reviewNotes = notes;
  return this.save();
};

const Report = mongoose.model('Report', reportSchema);

module.exports = { Report, REPORT_REASONS, CREDIBILITY_TIERS };
