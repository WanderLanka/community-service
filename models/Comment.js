const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    // Reference to the blog post, question, or answer
    post: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    
    // Type of post this comment belongs to
    postType: {
      type: String,
      enum: ['blogpost', 'question', 'answer'],
      default: 'blogpost',
      index: true
    },
    
    // Author of the comment (denormalized for microservices)
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
      profilePicture: {
        type: String,
        default: null
      }
    },
    
    // Comment content
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    
    // Parent comment ID (null for top-level comments)
    parentComment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Comment',
      default: null,
      index: true
    },
    
    // Nested level (0 for top-level, 1 for first reply, etc.)
    level: {
      type: Number,
      default: 0,
      min: 0,
      max: 10 // Limit nesting depth to prevent infinite recursion
    },
    
    // Users who liked this comment
    likes: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    
    // Like count (denormalized for performance)
    likesCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    // Reply count (denormalized for performance)
    repliesCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    // Soft delete flag
    isDeleted: {
      type: Boolean,
      default: false
    },
    
    // Deleted at timestamp
    deletedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Compound indexes for efficient queries
commentSchema.index({ post: 1, parentComment: 1, createdAt: -1 });
commentSchema.index({ post: 1, createdAt: -1 });
commentSchema.index({ author: 1, createdAt: -1 });
commentSchema.index({ parentComment: 1, createdAt: -1 });

// Virtual for replies (used in population)
commentSchema.virtual('replies', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'parentComment',
  options: { sort: { createdAt: 1 } }
});

// Instance Methods

/**
 * Add a like to the comment
 */
commentSchema.methods.addLike = function(userId) {
  if (!this.likes.includes(userId)) {
    this.likes.push(userId);
    this.likesCount = this.likes.length;
  }
  return this.save();
};

/**
 * Remove a like from the comment
 */
commentSchema.methods.removeLike = function(userId) {
  this.likes = this.likes.filter(id => id.toString() !== userId.toString());
  this.likesCount = this.likes.length;
  return this.save();
};

/**
 * Check if user has liked the comment
 */
commentSchema.methods.isLikedBy = function(userId) {
  return this.likes.some(id => id.toString() === userId.toString());
};

/**
 * Soft delete the comment
 */
commentSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.content = '[Comment deleted]';
  return this.save();
};

/**
 * Increment replies count
 */
commentSchema.methods.incrementRepliesCount = function() {
  this.repliesCount += 1;
  return this.save();
};

/**
 * Decrement replies count
 */
commentSchema.methods.decrementRepliesCount = function() {
  if (this.repliesCount > 0) {
    this.repliesCount -= 1;
  }
  return this.save();
};

// Static Methods

/**
 * Get comments for a post with nested replies
 * @param {String} postId - The post ID
 * @param {Object} options - Pagination and query options
 */
commentSchema.statics.getCommentsWithReplies = async function(postId, options = {}) {
  const {
    page = 1,
    limit = 20,
    userId = null
  } = options;

  const skip = (page - 1) * limit;

  // Get top-level comments with pagination
  const topComments = await this.find({
    post: postId,
    parentComment: null,
    isDeleted: false
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Get all reply IDs for these top comments
  const topCommentIds = topComments.map(c => c._id);

  // Fetch all nested replies in one query
  const allReplies = await this.find({
    post: postId,
    parentComment: { $in: topCommentIds },
    isDeleted: false
  })
    .sort({ createdAt: 1 })
    .lean();

  // Build nested structure
  const commentMap = {};
  topComments.forEach(comment => {
    commentMap[comment._id.toString()] = {
      ...comment,
      replies: [],
      isLikedByUser: userId ? comment.likes.some(id => id.toString() === userId.toString()) : false
    };
  });

  allReplies.forEach(reply => {
    const parentId = reply.parentComment.toString();
    if (commentMap[parentId]) {
      commentMap[parentId].replies.push({
        ...reply,
        isLikedByUser: userId ? reply.likes.some(id => id.toString() === userId.toString()) : false
      });
    }
  });

  return Object.values(commentMap);
};

/**
 * Get replies for a specific comment with pagination
 */
commentSchema.statics.getRepliesForComment = async function(commentId, options = {}) {
  const {
    page = 1,
    limit = 10,
    userId = null
  } = options;

  const skip = (page - 1) * limit;

  const replies = await this.find({
    parentComment: commentId,
    isDeleted: false
  })
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return replies.map(reply => ({
    ...reply,
    isLikedByUser: userId ? reply.likes.some(id => id.toString() === userId.toString()) : false
  }));
};

/**
 * Get total count of comments for a post
 */
commentSchema.statics.getCommentCount = async function(postId) {
  return this.countDocuments({
    post: postId,
    isDeleted: false
  });
};

/**
 * Delete all comments for a post (cascade delete)
 */
commentSchema.statics.deleteByPost = async function(postId) {
  return this.updateMany(
    { post: postId },
    { $set: { isDeleted: true, deletedAt: new Date(), content: '[Comment deleted]' } }
  );
};

// Middleware

// Update parent comment's replies count when a new comment is added
commentSchema.post('save', async function(doc) {
  if (doc.parentComment && !doc.isDeleted) {
    await mongoose.model('Comment').findByIdAndUpdate(
      doc.parentComment,
      { $inc: { repliesCount: 1 } }
    );
  }
});

const Comment = mongoose.model('Comment', commentSchema);

module.exports = Comment;
