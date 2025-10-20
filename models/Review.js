const mongoose = require('mongoose');

const reviewImageSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  publicId: {
    type: String,
    required: true
  },
  thumbnailUrl: String,
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

const reviewSchema = new mongoose.Schema({
  // Map point reference
  mapPoint: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MapPoint',
    required: true,
    index: true
  },

  // Author information
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
      enum: ['traveler', 'traveller', 'guide'],
      default: 'traveler'
    }
  },

  // Review content
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5'],
    validate: {
      validator: Number.isInteger,
      message: 'Rating must be an integer'
    }
  },

  comment: {
    type: String,
    required: [true, 'Comment is required'],
    trim: true,
    minlength: [10, 'Comment must be at least 10 characters'],
    maxlength: [1000, 'Comment cannot exceed 1000 characters']
  },

  // Optional images
  images: [reviewImageSchema],

  // Helpfulness tracking
  helpful: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    markedAt: {
      type: Date,
      default: Date.now
    }
  }],

  helpfulCount: {
    type: Number,
    default: 0
  },

  // Visit date (when user visited the place)
  visitDate: {
    type: Date
  },

  // Status and moderation
  status: {
    type: String,
    enum: ['published', 'pending', 'flagged', 'removed'],
    default: 'published'
  },

  // Metadata
  edited: {
    type: Boolean,
    default: false
  },

  editedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
reviewSchema.index({ mapPoint: 1, createdAt: -1 });
reviewSchema.index({ 'author.userId': 1, createdAt: -1 });
reviewSchema.index({ rating: -1 });
reviewSchema.index({ helpfulCount: -1 });
reviewSchema.index({ status: 1 });

// Compound index for user-specific queries
reviewSchema.index({ mapPoint: 1, 'author.userId': 1 }, { unique: true });

// Methods

/**
 * Convert review to client-safe JSON
 */
reviewSchema.methods.toClientJSON = function(currentUserId = null) {
  const review = this.toObject();

  return {
    _id: review._id,
    mapPointId: review.mapPoint,
    author: {
      userId: review.author.userId,
      username: review.author.username,
      avatar: review.author.avatar,
      role: review.author.role
    },
    rating: review.rating,
    comment: review.comment,
    images: review.images || [],
    visitDate: review.visitDate,
    helpfulCount: review.helpfulCount,
    isHelpful: currentUserId ? review.helpful.some(h => h.userId.toString() === currentUserId.toString()) : false,
    isAuthor: currentUserId ? review.author.userId.toString() === currentUserId.toString() : false,
    edited: review.edited,
    editedAt: review.editedAt,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    status: review.status
  };
};

/**
 * Mark review as helpful
 */
reviewSchema.methods.markHelpful = function(userId) {
  const alreadyMarked = this.helpful.some(h => h.userId.toString() === userId.toString());
  
  if (!alreadyMarked) {
    this.helpful.push({ userId, markedAt: new Date() });
    this.helpfulCount = this.helpful.length;
  }
  
  return this.save();
};

/**
 * Unmark review as helpful
 */
reviewSchema.methods.unmarkHelpful = function(userId) {
  this.helpful = this.helpful.filter(h => h.userId.toString() !== userId.toString());
  this.helpfulCount = this.helpful.length;
  
  return this.save();
};

// Static methods

/**
 * Get reviews for a map point
 */
reviewSchema.statics.getMapPointReviews = async function(mapPointId, options = {}) {
  const {
    page = 1,
    limit = 10,
    sort = 'recent', // recent, helpful, rating
    minRating = 1
  } = options;

  const skip = (page - 1) * limit;
  let sortOption = {};

  switch (sort) {
    case 'helpful':
      sortOption = { helpfulCount: -1, createdAt: -1 };
      break;
    case 'rating':
      sortOption = { rating: -1, createdAt: -1 };
      break;
    case 'recent':
    default:
      sortOption = { createdAt: -1 };
  }

  const query = {
    mapPoint: mapPointId,
    status: 'published',
    rating: { $gte: minRating }
  };

  const reviews = await this.find(query)
    .sort(sortOption)
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await this.countDocuments(query);

  return {
    reviews,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      itemsPerPage: limit
    }
  };
};

/**
 * Calculate average rating for a map point
 */
reviewSchema.statics.calculateAverageRating = async function(mapPointId) {
  const result = await this.aggregate([
    {
      $match: {
        mapPoint: mapPointId,
        status: 'published'
      }
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        ratings: {
          $push: '$rating'
        }
      }
    }
  ]);

  if (result.length === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
  }

  const data = result[0];
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  
  data.ratings.forEach(rating => {
    distribution[rating] = (distribution[rating] || 0) + 1;
  });

  return {
    averageRating: Math.round(data.averageRating * 10) / 10,
    totalReviews: data.totalReviews,
    ratingDistribution: distribution
  };
};

// Middleware

/**
 * Update map point rating after review save
 */
reviewSchema.post('save', async function() {
  if (this.status === 'published') {
    const MapPoint = mongoose.model('MapPoint');
    const stats = await this.constructor.calculateAverageRating(this.mapPoint);
    
    await MapPoint.findByIdAndUpdate(this.mapPoint, {
      rating: stats.averageRating,
      commentsCount: stats.totalReviews
    });
  }
});

/**
 * Update map point rating after review delete
 */
reviewSchema.post('findOneAndDelete', async function(doc) {
  if (doc && doc.status === 'published') {
    const MapPoint = mongoose.model('MapPoint');
    const stats = await doc.constructor.calculateAverageRating(doc.mapPoint);
    
    await MapPoint.findByIdAndUpdate(doc.mapPoint, {
      rating: stats.averageRating,
      commentsCount: stats.totalReviews
    });
  }
});

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
