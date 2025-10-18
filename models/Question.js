const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 100,
  },
  content: {
    type: String,
    required: true,
    trim: true,
    minlength: 20,
    maxlength: 2000,
  },
  category: {
    type: String,
    required: true,
    enum: [
      'travel-tips',
      'safety',
      'transportation',
      'food-dining',
      'accommodation',
      'activities',
      'culture',
      'budget',
    ],
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
  }],
  askedBy: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    username: {
      type: String,
      required: true,
    },
    reputation: {
      type: Number,
      default: 0,
    },
    isAnonymous: {
      type: Boolean,
      default: false,
    },
  },
  views: {
    type: Number,
    default: 0,
  },
  viewedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  votes: {
    upvotes: {
      type: Number,
      default: 0,
    },
    downvotes: {
      type: Number,
      default: 0,
    },
    score: {
      type: Number,
      default: 0, // upvotes - downvotes
    },
  },
  votedBy: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    voteType: {
      type: String,
      enum: ['up', 'down'],
    },
  }],
  answersCount: {
    type: Number,
    default: 0,
  },
  isFeatured: {
    type: Boolean,
    default: false,
  },
  isAnswered: {
    type: Boolean,
    default: false,
  },
  bestAnswerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Answer',
    default: null,
  },
  // Moderation fields
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  editedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Indexes for better query performance
questionSchema.index({ 'askedBy.userId': 1, createdAt: -1 });
questionSchema.index({ category: 1, createdAt: -1 });
questionSchema.index({ tags: 1 });
questionSchema.index({ 'votes.score': -1 });
questionSchema.index({ isFeatured: 1, createdAt: -1 });
questionSchema.index({ isAnswered: 1, createdAt: -1 });
questionSchema.index({ views: -1 });

// Virtual for total votes
questionSchema.virtual('totalVotes').get(function() {
  return this.votes.upvotes + this.votes.downvotes;
});

// Method to increment view count
questionSchema.methods.incrementView = async function(userId = null) {
  this.views += 1;
  
  // Track unique viewers if userId provided
  if (userId && !this.viewedBy.includes(userId)) {
    this.viewedBy.push(userId);
  }
  
  await this.save();
  return this.views;
};

// Method to add/update vote
questionSchema.methods.updateVote = async function(userId, voteType) {
  // Remove existing vote if any
  const existingVoteIndex = this.votedBy.findIndex(
    v => v.userId.toString() === userId.toString()
  );
  
  if (existingVoteIndex !== -1) {
    const existingVote = this.votedBy[existingVoteIndex];
    
    // If same vote type, remove vote (toggle off)
    if (existingVote.voteType === voteType) {
      this.votedBy.splice(existingVoteIndex, 1);
      if (voteType === 'up') {
        this.votes.upvotes -= 1;
      } else {
        this.votes.downvotes -= 1;
      }
    } else {
      // Change vote type
      this.votedBy[existingVoteIndex].voteType = voteType;
      if (voteType === 'up') {
        this.votes.upvotes += 1;
        this.votes.downvotes -= 1;
      } else {
        this.votes.downvotes += 1;
        this.votes.upvotes -= 1;
      }
    }
  } else {
    // Add new vote
    this.votedBy.push({ userId, voteType });
    if (voteType === 'up') {
      this.votes.upvotes += 1;
    } else {
      this.votes.downvotes += 1;
    }
  }
  
  // Update score
  this.votes.score = this.votes.upvotes - this.votes.downvotes;
  
  await this.save();
  return this;
};

// Method to set best answer
questionSchema.methods.setBestAnswer = async function(answerId) {
  this.bestAnswerId = answerId;
  this.isAnswered = true;
  await this.save();
  return this;
};

// Method to increment answers count
questionSchema.methods.incrementAnswersCount = async function() {
  this.answersCount += 1;
  if (this.answersCount > 0 && !this.isAnswered) {
    this.isAnswered = true;
  }
  await this.save();
  return this;
};

// Method to decrement answers count
questionSchema.methods.decrementAnswersCount = async function() {
  if (this.answersCount > 0) {
    this.answersCount -= 1;
    if (this.answersCount === 0) {
      this.isAnswered = false;
      this.bestAnswerId = null;
    }
  }
  await this.save();
  return this;
};

// Static method to get user's vote on question
questionSchema.statics.getUserVote = function(question, userId) {
  if (!userId) return null;
  const vote = question.votedBy.find(v => v.userId.toString() === userId.toString());
  return vote ? vote.voteType : null;
};

// Ensure virtuals are included in JSON
questionSchema.set('toJSON', { virtuals: true });
questionSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Question', questionSchema);
