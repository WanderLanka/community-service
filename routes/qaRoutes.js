const express = require('express');
const router = express.Router();
const Question = require('../models/Question');
const Answer = require('../models/Answer');
const Comment = require('../models/Comment');
const { verifyToken } = require('../middleware/auth');

// ==================== QUESTION ROUTES ====================

/**
 * @route   POST /api/community/questions
 * @desc    Ask a new question
 * @access  Private
 */
router.post('/questions', verifyToken, async (req, res) => {
  try {
    const { title, content, category, tags, isAnonymous } = req.body;
    const { userId, username } = req.user;

    // Validation
    if (!title || title.trim().length < 10 || title.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Title must be between 10 and 100 characters',
      });
    }

    if (!content || content.trim().length < 20 || content.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Content must be between 20 and 2000 characters',
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Category is required',
      });
    }

    // Create question
    const question = new Question({
      title: title.trim(),
      content: content.trim(),
      category,
      tags: tags ? tags.map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0) : [],
      askedBy: {
        userId,
        username: isAnonymous ? 'Anonymous' : username,
        reputation: 0, // TODO: Get from user profile
        isAnonymous: isAnonymous || false,
      },
    });

    await question.save();

    console.log(`✅ Question created by ${username}: "${title.substring(0, 50)}..."`);

    res.status(201).json({
      success: true,
      message: 'Question posted successfully',
      data: {
        question: {
          id: question._id,
          title: question.title,
          content: question.content,
          category: question.category,
          tags: question.tags,
          askedBy: question.askedBy,
          createdAt: question.createdAt,
        },
      },
    });
  } catch (error) {
    console.error('Error creating question:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create question',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/community/questions
 * @desc    Get all questions with filters and sorting
 * @access  Public
 */
router.get('/questions', async (req, res) => {
  try {
    const {
      category,
      tags,
      featured,
      answered,
      sort = 'recent',
      page = 1,
      limit = 20,
      userId, // For checking user votes
    } = req.query;

    // Build filter
    const filter = { isDeleted: false };
    
    if (category) {
      filter.category = category;
    }
    
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      filter.tags = { $in: tagArray };
    }
    
    if (featured === 'true') {
      filter.isFeatured = true;
    }
    
    if (answered === 'true') {
      filter.isAnswered = true;
    } else if (answered === 'false') {
      filter.isAnswered = false;
    }

    // Build sort
    let sortOption = {};
    switch (sort) {
      case 'popular':
        sortOption = { views: -1, 'votes.score': -1 };
        break;
      case 'votes':
        sortOption = { 'votes.score': -1, createdAt: -1 };
        break;
      case 'answers':
        sortOption = { answersCount: -1, createdAt: -1 };
        break;
      case 'recent':
      default:
        sortOption = { createdAt: -1 };
        break;
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [questions, total] = await Promise.all([
      Question.find(filter)
        .sort(sortOption)
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      Question.countDocuments(filter),
    ]);

    // Add user vote info if userId provided
    const questionsWithVotes = questions.map(question => ({
      ...question,
      userVote: userId ? Question.getUserVote(question, userId) : null,
    }));

    res.json({
      success: true,
      data: {
        questions: questionsWithVotes,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch questions',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/community/questions/:id
 * @desc    Get a single question by ID
 * @access  Public
 */
router.get('/questions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    const question = await Question.findById(id);

    if (!question || question.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    // Increment view count
    await question.incrementView(userId);

    // Get user vote if userId provided
    const userVote = userId ? Question.getUserVote(question, userId) : null;

    res.json({
      success: true,
      data: {
        question: {
          ...question.toObject(),
          userVote,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching question:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch question',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/community/questions/:id/vote
 * @desc    Vote on a question (upvote/downvote)
 * @access  Private
 */
router.post('/questions/:id/vote', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { voteType } = req.body;
    const { userId } = req.user;

    if (!['up', 'down'].includes(voteType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vote type. Must be "up" or "down"',
      });
    }

    const question = await Question.findById(id);

    if (!question || question.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    // Cannot vote on own question
    if (question.askedBy.userId.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot vote on your own question',
      });
    }

    // Update vote
    await question.updateVote(userId, voteType);

    res.json({
      success: true,
      message: 'Vote updated successfully',
      data: {
        votes: question.votes,
        userVote: Question.getUserVote(question, userId),
      },
    });
  } catch (error) {
    console.error('Error voting on question:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to vote on question',
      error: error.message,
    });
  }
});

// ==================== ANSWER ROUTES ====================

/**
 * @route   POST /api/community/questions/:id/answers
 * @desc    Post an answer to a question
 * @access  Private
 */
router.post('/questions/:id/answers', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const { userId, username, role } = req.user;

    // Validation
    if (!content || content.trim().length < 10 || content.trim().length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Answer content must be between 10 and 5000 characters',
      });
    }

    const question = await Question.findById(id);

    if (!question || question.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    // Create answer
    const answer = new Answer({
      question: id,
      content: content.trim(),
      answeredBy: {
        userId,
        username,
        reputation: 0, // TODO: Get from user profile
        verified: role === 'guide', // Tour guides are verified
      },
    });

    await answer.save();

    // Increment question's answer count
    await question.incrementAnswersCount();

    console.log(`✅ Answer posted by ${username} to question "${question.title.substring(0, 30)}..."`);

    res.status(201).json({
      success: true,
      message: 'Answer posted successfully',
      data: {
        answer: {
          id: answer._id,
          content: answer.content,
          answeredBy: answer.answeredBy,
          votes: answer.votes,
          helpfulCount: answer.helpfulCount,
          isBestAnswer: answer.isBestAnswer,
          createdAt: answer.createdAt,
        },
      },
    });
  } catch (error) {
    console.error('Error posting answer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to post answer',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/community/questions/:id/answers
 * @desc    Get all answers for a question
 * @access  Public
 */
router.get('/questions/:id/answers', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, sort = 'best' } = req.query;

    const question = await Question.findById(id);

    if (!question || question.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    // Build sort
    let sortOption = {};
    switch (sort) {
      case 'votes':
        sortOption = { 'votes.score': -1, createdAt: -1 };
        break;
      case 'recent':
        sortOption = { createdAt: -1 };
        break;
      case 'best':
      default:
        // Best answer first, then by votes
        sortOption = { isBestAnswer: -1, 'votes.score': -1, createdAt: -1 };
        break;
    }

    const answers = await Answer.find({ question: id, isDeleted: false })
      .sort(sortOption)
      .lean();

    // Add user interaction info if userId provided
    const answersWithUserData = answers.map(answer => ({
      ...answer,
      userVote: userId ? Answer.getUserVote(answer, userId) : null,
      isMarkedHelpful: userId ? Answer.isMarkedHelpful(answer, userId) : false,
    }));

    res.json({
      success: true,
      data: {
        answers: answersWithUserData,
        count: answers.length,
      },
    });
  } catch (error) {
    console.error('Error fetching answers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch answers',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/community/answers/:id/vote
 * @desc    Vote on an answer (upvote/downvote)
 * @access  Private
 */
router.post('/answers/:id/vote', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { voteType } = req.body;
    const { userId } = req.user;

    if (!['up', 'down'].includes(voteType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vote type. Must be "up" or "down"',
      });
    }

    const answer = await Answer.findById(id);

    if (!answer || answer.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Answer not found',
      });
    }

    // Cannot vote on own answer
    if (answer.answeredBy.userId.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot vote on your own answer',
      });
    }

    // Update vote
    await answer.updateVote(userId, voteType);

    res.json({
      success: true,
      message: 'Vote updated successfully',
      data: {
        votes: answer.votes,
        userVote: Answer.getUserVote(answer, userId),
      },
    });
  } catch (error) {
    console.error('Error voting on answer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to vote on answer',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/community/answers/:id/helpful
 * @desc    Mark an answer as helpful
 * @access  Private
 */
router.post('/answers/:id/helpful', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const answer = await Answer.findById(id);

    if (!answer || answer.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Answer not found',
      });
    }

    // Toggle helpful mark
    await answer.toggleHelpful(userId);

    res.json({
      success: true,
      message: 'Helpful status updated',
      data: {
        helpfulCount: answer.helpfulCount,
        isMarkedHelpful: Answer.isMarkedHelpful(answer, userId),
      },
    });
  } catch (error) {
    console.error('Error marking answer as helpful:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark answer as helpful',
      error: error.message,
    });
  }
});

/**
 * @route   PATCH /api/community/answers/:id/best
 * @desc    Mark/unmark answer as best answer (question author only)
 * @access  Private
 */
router.patch('/answers/:id/best', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { markAsBest } = req.body;
    const { userId } = req.user;

    const answer = await Answer.findById(id);

    if (!answer || answer.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Answer not found',
      });
    }

    // Get question to verify ownership
    const question = await Question.findById(answer.question);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    // Only question author can mark best answer
    if (question.askedBy.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the question author can mark best answer',
      });
    }

    // Mark or unmark as best
    if (markAsBest) {
      await answer.markAsBest();
    } else {
      await answer.unmarkAsBest();
    }

    res.json({
      success: true,
      message: markAsBest ? 'Answer marked as best' : 'Best answer mark removed',
      data: {
        answer: {
          id: answer._id,
          isBestAnswer: answer.isBestAnswer,
        },
      },
    });
  } catch (error) {
    console.error('Error marking best answer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark best answer',
      error: error.message,
    });
  }
});

// ==================== COMMENT ROUTES (Reuse existing Comment model) ====================

/**
 * @route   POST /api/community/questions/:id/comments
 * @desc    Add a comment to a question
 * @access  Private
 */
router.post('/questions/:id/comments', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, parentId } = req.body;
    const { userId, username } = req.user;

    if (!content || content.trim().length < 1 || content.trim().length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Comment must be between 1 and 500 characters',
      });
    }

    const question = await Question.findById(id);
    if (!question || question.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    const comment = new Comment({
      content: content.trim(),
      author: {
        userId,
        username,
      },
      post: id,
      postType: 'question',
      parentComment: parentId || null,
    });

    await comment.save();

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: { comment },
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/community/questions/:id/comments
 * @desc    Get all comments for a question
 * @access  Public
 */
router.get('/questions/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;

    const comments = await Comment.find({
      post: id,
      postType: 'question',
      isDeleted: false,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { comments, count: comments.length },
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comments',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/community/answers/:id/comments
 * @desc    Add a comment to an answer
 * @access  Private
 */
router.post('/answers/:id/comments', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, parentId } = req.body;
    const { userId, username } = req.user;

    if (!content || content.trim().length < 1 || content.trim().length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Comment must be between 1 and 500 characters',
      });
    }

    const answer = await Answer.findById(id);
    if (!answer || answer.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Answer not found',
      });
    }

    const comment = new Comment({
      content: content.trim(),
      author: {
        userId,
        username,
      },
      post: id,
      postType: 'answer',
      parentComment: parentId || null,
    });

    await comment.save();

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: { comment },
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/community/answers/:id/comments
 * @desc    Get all comments for an answer
 * @access  Public
 */
router.get('/answers/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;

    const comments = await Comment.find({
      post: id,
      postType: 'answer',
      isDeleted: false,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { comments, count: comments.length },
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comments',
      error: error.message,
    });
  }
});

module.exports = router;
