const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  publicId: {
    type: String,
    required: true,
    index: true
  },
  thumbnailUrl: String,
  mediumUrl: String,
  format: String,
  width: Number,
  height: Number,
  bytes: Number,
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

const mapPointSchema = new mongoose.Schema({
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
      enum: ['traveler', 'traveller', 'guide'],
      default: 'traveler'
    }
  },

  // Point information
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },

  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },

  // Location information
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: [true, 'Coordinates are required'],
      validate: {
        validator: function(coords) {
          return coords.length === 2 && 
                 coords[0] >= -180 && coords[0] <= 180 && // longitude
                 coords[1] >= -90 && coords[1] <= 90;      // latitude
        },
        message: 'Invalid coordinates. Must be [longitude, latitude]'
      }
    }
  },

  // Address/place name
  address: {
    type: String,
    trim: true
  },

  placeName: {
    type: String,
    trim: true
  },

  // Google Place ID for reference
  placeId: {
    type: String,
    index: true
  },

  // Category/type of place
  category: {
    type: String,
    enum: [
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
    ],
    default: 'other'
  },

  // Images
  images: [imageSchema],

  // Tags
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],

  // Ratings and engagement
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: 5
  },

  likes: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    likedAt: {
      type: Date,
      default: Date.now
    }
  }],

  likesCount: {
    type: Number,
    default: 0
  },

  // Comments count (for display)
  commentsCount: {
    type: Number,
    default: 0
  },

  // Saves/bookmarks
  saves: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    savedAt: {
      type: Date,
      default: Date.now
    }
  }],

  savesCount: {
    type: Number,
    default: 0
  },

  // Visibility and moderation
  status: {
    type: String,
    enum: ['draft', 'published', 'archived', 'flagged'],
    default: 'published',
    index: true
  },

  visibility: {
    type: String,
    enum: ['public', 'private', 'followers'],
    default: 'public'
  },

  // Verification
  isVerified: {
    type: Boolean,
    default: false
  },

  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  verifiedAt: Date,

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
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
mapPointSchema.index({ 'location': '2dsphere' }); // Geospatial index
mapPointSchema.index({ 'author.userId': 1, createdAt: -1 });
mapPointSchema.index({ status: 1, createdAt: -1 });
mapPointSchema.index({ category: 1, createdAt: -1 });
mapPointSchema.index({ tags: 1 });
mapPointSchema.index({ likesCount: -1 });
mapPointSchema.index({ createdAt: -1 });

// Virtual for checking if user liked
mapPointSchema.virtual('isLiked').get(function() {
  return false; // Will be set in controller based on requesting user
});

// Virtual for checking if user saved
mapPointSchema.virtual('isSaved').get(function() {
  return false; // Will be set in controller based on requesting user
});

// Pre-save middleware
mapPointSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Update counts
  this.likesCount = this.likes.length;
  this.savesCount = this.saves.length;
  
  next();
});

// Methods
mapPointSchema.methods.toClientJSON = function(userId) {
  const obj = this.toObject();
  
  // Check if current user liked/saved
  if (userId) {
    obj.isLiked = this.likes.some(like => like.userId.toString() === userId.toString());
    obj.isSaved = this.saves.some(save => save.userId.toString() === userId.toString());
  }
  
  // Remove sensitive data
  delete obj.likes;
  delete obj.saves;
  delete obj.__v;
  
  return obj;
};

// Static methods
mapPointSchema.statics.findNearby = function(longitude, latitude, maxDistance = 10000, limit = 20) {
  return this.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance // in meters
      }
    },
    status: 'published'
  })
  .limit(limit)
  .sort({ createdAt: -1 });
};

mapPointSchema.statics.findByCategory = function(category, limit = 20) {
  return this.find({ category, status: 'published' })
    .sort({ createdAt: -1 })
    .limit(limit);
};

mapPointSchema.statics.findPopular = function(limit = 20) {
  return this.find({ status: 'published' })
    .sort({ likesCount: -1, createdAt: -1 })
    .limit(limit);
};

const MapPoint = mongoose.model('MapPoint', mapPointSchema);

module.exports = MapPoint;
