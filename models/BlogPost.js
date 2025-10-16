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

const commentSchema = new mongoose.Schema({
  user: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    username: {
      type: String,
      required: true
    },
    avatar: String
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

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
  
  comments: [commentSchema],
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
  this.commentsCount = this.comments.length;
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

blogPostSchema.methods.addComment = function(userId, username, content, avatar) {
  this.comments.push({
    user: { userId, username, avatar },
    content,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  this.commentsCount = this.comments.length;
  return this.save();
};

blogPostSchema.methods.removeComment = function(commentId) {
  this.comments = this.comments.filter(comment => comment._id.toString() !== commentId.toString());
  this.commentsCount = this.comments.length;
  return this.save();
};

blogPostSchema.methods.incrementViews = function() {
  this.viewsCount += 1;
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
