const { start, installReadiness } = require('./runtime');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const communityRoutes = require('./routes/communityRoutes');
const commentRoutes = require('./routes/commentRoutes');
const reportRoutes = require('./routes/reportRoutes');
const qaRoutes = require('./routes/qaRoutes');
const mapPointRoutes = require('./routes/mapPointRoutes');

const app = express();
installReadiness(app);

// Middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000', 'http://localhost:8081'],
  credentials: true
}));

// Increase payload size limits for image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Set server timeout to 5 minutes for large file uploads
app.timeout = 300000; // 5 minutes

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes
app.use('/api/', limiter);

// Stricter rate limiting for post creation
const createPostLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 posts per hour
  message: {
    success: false,
    message: 'Too many posts created. Please try again later.'
  }
});

app.use('/api/community/posts', createPostLimiter);

// MongoDB connection event handlers
mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

// Debug: Log registered routes
console.log('\n📋 Registering routes:');
console.log('   /api/community/* → communityRoutes, commentRoutes, reportRoutes, qaRoutes, mapPointRoutes');
console.log('   /posts → communityRoutes (for API Gateway proxy)');
console.log('   /comments → commentRoutes (for API Gateway proxy)');
console.log('   /reports → reportRoutes (for API Gateway proxy)');
console.log('   /questions → qaRoutes (for API Gateway proxy)');
console.log('   /map-points → mapPointRoutes (for API Gateway proxy)\n');

// Health check endpoint - must be before catch-all routes
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'community-service',
    status: 'running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Import review routes
const reviewRoutes = require('./routes/reviewRoutes');

// Routes - handle both direct access and proxied requests
// All routes define their full paths
app.use('/api/community', communityRoutes);
app.use('/api/community', commentRoutes);
app.use('/api/community', reportRoutes);
app.use('/api/community', qaRoutes);
app.use('/api/community', mapPointRoutes); // Routes already have /map-points prefix
app.use('/api/community', reviewRoutes); // Review routes

// For API Gateway proxy (after /api/community is stripped by pathRewrite)
// Mount at root so routes like /posts, /questions, /map-points work directly
app.use('/', communityRoutes);
app.use('/', commentRoutes);
app.use('/', reportRoutes);
app.use('/', qaRoutes);
app.use('/', mapPointRoutes); // Routes already have /map-points prefix
app.use('/', reviewRoutes); // Review routes

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'WanderLanka Community Service API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      posts: {
        getAll: 'GET /api/community/posts',
        getById: 'GET /api/community/posts/:id',
        getByUser: 'GET /api/community/posts/user/:userId',
        create: 'POST /api/community/posts',
        update: 'PUT /api/community/posts/:id',
        delete: 'DELETE /api/community/posts/:id',
        like: 'POST /api/community/posts/:id/like',
        unlike: 'DELETE /api/community/posts/:id/like',
        addComment: 'POST /api/community/posts/:id/comments',
        deleteComment: 'DELETE /api/community/posts/:id/comments/:commentId'
      }
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Global error handler:', err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});


if (require.main === module) {
  start(app, { connect: () => mongoose.connect(process.env.MONGO_URI), port: process.env.PORT || 3007 }).catch(error => {
    console.error('Service startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = app;
