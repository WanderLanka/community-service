const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  // Cloudinary URLs (stored for quick access)
  url: {
    type: String,
    required: true
  },
  publicId: {
    type: String,
    required: true,
    index: true
  },
  // Different sizes for responsive images
  thumbnailUrl: String,
  mediumUrl: String,
  largeUrl: String,
  // Image metadata
  format: String,
  width: Number,
  height: Number,
  bytes: Number,
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

// NOTE: Comment schema has been moved to a separate Comment model (models/Comment.js)
// for better support of nested comments, likes, and efficient querying

const blogPostSchema = new mongoose.Schema({
  // User information
  author: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    username: {
      type: String,
      required: true
    },
    avatar: String,
    role: {
      type: String,
      enum: ['traveller', 'guide'],
      default: 'traveller'
    }
  },
  
  // Post content
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000
  },
  location: {
    name: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  
  // Images - efficient storage strategy
  images: [imageSchema],
  
  // Social features
  likes: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    username: String,
    likedAt: {
      type: Date,
      default: Date.now
    }
  }],
  likesCount: {
    type: Number,
    default: 0,
    index: true
  },
  
  // NOTE: Comments are now stored in a separate Comment collection
  // commentsCount tracks the total count for performance
  commentsCount: {
    type: Number,
    default: 0
  },
  
  // Post metadata
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'published',
    index: true
  },
  viewsCount: {
    type: Number,
    default: 0
  },
  
  // Post settings
  settings: {
    allowComments: {
      type: Boolean,
      default: true
    },
    allowSharing: {
      type: Boolean,
      default: true
    }
  },

  // Hide feature - users who have hidden this post
  hiddenBy: [{
    type: mongoose.Schema.Types.ObjectId,
    index: true
  }],

  // Report tracking
  reportCount: {
    type: Number,
    default: 0,
    index: true
  },

  totalReportScore: {
    type: Number,
    default: 0
  },

  isFlagged: {
    type: Boolean,
    default: false,
    index: true
  },

  flaggedAt: {
    type: Date,
    default: null
  },

  flagReason: {
    type: String,
    default: null
  },

  flagSeverity: {
    type: String,
    enum: ['none', 'moderate', 'high', 'critical'],
    default: 'none'
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
blogPostSchema.index({ 'author.userId': 1, createdAt: -1 });
blogPostSchema.index({ createdAt: -1 });
blogPostSchema.index({ likesCount: -1 });
blogPostSchema.index({ tags: 1 });
blogPostSchema.index({ status: 1, createdAt: -1 });

// Pre-save middleware to update counts
blogPostSchema.pre('save', function(next) {
  this.likesCount = this.likes.length;
  // commentsCount is managed by Comment model methods
  this.updatedAt = Date.now();
  next();
});

// Instance methods
blogPostSchema.methods.addLike = function(userId, username) {
  const existingLike = this.likes.find(like => like.userId.toString() === userId.toString());
  if (!existingLike) {
    this.likes.push({ userId, username, likedAt: Date.now() });
    this.likesCount = this.likes.length;
  }
  return this.save();
};

blogPostSchema.methods.removeLike = function(userId) {
  this.likes = this.likes.filter(like => like.userId.toString() !== userId.toString());
  this.likesCount = this.likes.length;
  return this.save();
};

// NOTE: addComment and removeComment methods have been removed.
// Use the Comment model directly (models/Comment.js) for comment operations.

blogPostSchema.methods.incrementViews = function() {
  this.viewsCount += 1;
  return this.save();
};

blogPostSchema.methods.incrementCommentsCount = function() {
  this.commentsCount += 1;
  return this.save();
};

blogPostSchema.methods.decrementCommentsCount = function() {
  if (this.commentsCount > 0) {
    this.commentsCount -= 1;
  }
  return this.save();
};

// Hide/Unhide methods
blogPostSchema.methods.hideForUser = function(userId) {
  if (!this.hiddenBy.includes(userId)) {
    this.hiddenBy.push(userId);
  }
  return this.save();
};

blogPostSchema.methods.unhideForUser = function(userId) {
  this.hiddenBy = this.hiddenBy.filter(id => id.toString() !== userId.toString());
  return this.save();
};

blogPostSchema.methods.isHiddenForUser = function(userId) {
  return this.hiddenBy.some(id => id.toString() === userId.toString());
};

// Report tracking methods
blogPostSchema.methods.addReport = function(weightedScore) {
  this.reportCount += 1;
  this.totalReportScore += weightedScore;
  return this.save();
};

blogPostSchema.methods.flagPost = function(severity, reason) {
  this.isFlagged = true;
  this.flaggedAt = new Date();
  this.flagSeverity = severity;
  this.flagReason = reason;
  return this.save();
};

blogPostSchema.methods.unflagPost = function() {
  this.isFlagged = false;
  this.flaggedAt = null;
  this.flagSeverity = 'none';
  this.flagReason = null;
  return this.save();
};

// Static methods for common queries
blogPostSchema.statics.findPublished = function(options = {}) {
  const { limit = 20, skip = 0, sort = { createdAt: -1 } } = options;
  return this.find({ status: 'published' })
    .sort(sort)
    .limit(limit)
    .skip(skip);
};

blogPostSchema.statics.findByAuthor = function(userId, options = {}) {
  const { limit = 20, skip = 0 } = options;
  return this.find({ 'author.userId': userId, status: 'published' })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);
};

blogPostSchema.statics.findPopular = function(days = 7, limit = 10) {
  const dateThreshold = new Date();
  dateThreshold.setDate(dateThreshold.getDate() - days);
  
  return this.find({
    status: 'published',
    createdAt: { $gte: dateThreshold }
  })
    .sort({ likesCount: -1, viewsCount: -1 })
    .limit(limit);
};

const BlogPost = mongoose.model('BlogPost', blogPostSchema);

module.exports = BlogPost;
