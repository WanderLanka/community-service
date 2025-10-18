const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  question: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Question',
    index: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 5000,
  },
  answeredBy: {
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
    verified: {
      type: Boolean,
      default: false,
    },
  },
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
  helpfulCount: {
    type: Number,
    default: 0,
  },
  markedHelpfulBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  isBestAnswer: {
    type: Boolean,
    default: false,
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
answerSchema.index({ question: 1, createdAt: -1 });
answerSchema.index({ 'answeredBy.userId': 1, createdAt: -1 });
answerSchema.index({ 'votes.score': -1 });
answerSchema.index({ isBestAnswer: 1 });

// Virtual for total votes
answerSchema.virtual('totalVotes').get(function() {
  return this.votes.upvotes + this.votes.downvotes;
});

// Method to add/update vote
answerSchema.methods.updateVote = async function(userId, voteType) {
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

// Method to toggle helpful mark
answerSchema.methods.toggleHelpful = async function(userId) {
  const userIdStr = userId.toString();
  const index = this.markedHelpfulBy.findIndex(id => id.toString() === userIdStr);
  
  if (index !== -1) {
    // Remove helpful mark
    this.markedHelpfulBy.splice(index, 1);
    this.helpfulCount -= 1;
  } else {
    // Add helpful mark
    this.markedHelpfulBy.push(userId);
    this.helpfulCount += 1;
  }
  
  await this.save();
  return this;
};

// Method to mark as best answer
answerSchema.methods.markAsBest = async function() {
  const Question = mongoose.model('Question');
  
  // Remove best answer status from other answers of the same question
  await Answer.updateMany(
    { question: this.question, _id: { $ne: this._id } },
    { isBestAnswer: false }
  );
  
  // Mark this answer as best
  this.isBestAnswer = true;
  await this.save();
  
  // Update question
  await Question.findByIdAndUpdate(this.question, {
    bestAnswerId: this._id,
    isAnswered: true,
  });
  
  return this;
};

// Method to unmark as best answer
answerSchema.methods.unmarkAsBest = async function() {
  const Question = mongoose.model('Question');
  
  this.isBestAnswer = false;
  await this.save();
  
  // Update question
  await Question.findByIdAndUpdate(this.question, {
    bestAnswerId: null,
  });
  
  return this;
};

// Static method to get user's vote on answer
answerSchema.statics.getUserVote = function(answer, userId) {
  if (!userId) return null;
  const vote = answer.votedBy.find(v => v.userId.toString() === userId.toString());
  return vote ? vote.voteType : null;
};

// Static method to check if user marked answer as helpful
answerSchema.statics.isMarkedHelpful = function(answer, userId) {
  if (!userId) return false;
  return answer.markedHelpfulBy.some(id => id.toString() === userId.toString());
};

// Ensure virtuals are included in JSON
answerSchema.set('toJSON', { virtuals: true });
answerSchema.set('toObject', { virtuals: true });

const Answer = mongoose.model('Answer', answerSchema);
module.exports = Answer;
