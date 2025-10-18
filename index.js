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

const app = express();

// Debug middleware - log ALL incoming requests
app.use((req, res, next) => {
  console.log('\n' + '='.repeat(60));
  console.log('📥 INCOMING REQUEST:');
  console.log(`   Method: ${req.method}`);
  console.log(`   URL: ${req.url}`);
  console.log(`   Original URL: ${req.originalUrl}`);
  console.log(`   Path: ${req.path}`);
  console.log(`   Base URL: ${req.baseUrl}`);
  console.log(`   Headers:`, JSON.stringify(req.headers, null, 2));
  console.log('='.repeat(60) + '\n');
  next();
});

// Middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000', 'http://localhost:8081'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected successfully');
    console.log(`🗄️ Database: ${mongoose.connection.name}`);
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// MongoDB connection event handlers
mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

// Debug: Log registered routes
console.log('\n📋 Registering routes:');
console.log('   /api/community/* → communityRoutes, commentRoutes, reportRoutes, qaRoutes');
console.log('   /posts → communityRoutes (for API Gateway proxy)');
console.log('   /comments → commentRoutes (for API Gateway proxy)');
console.log('   /reports → reportRoutes (for API Gateway proxy)');
console.log('   /questions → qaRoutes (for API Gateway proxy)\n');

// Routes - handle both direct access and proxied requests
// When accessed through API Gateway, the /api/community prefix is stripped
app.use('/api/community', communityRoutes);
app.use('/api/community', commentRoutes);
app.use('/api/community', reportRoutes);
app.use('/api/community', qaRoutes);
app.use('/posts', communityRoutes); // For API Gateway (pathRewrite strips /api/community)
app.use('/comments', commentRoutes); // For API Gateway (pathRewrite strips /api/community)
app.use('/reports', reportRoutes); // For API Gateway (pathRewrite strips /api/community)
app.use('/questions', qaRoutes); // For API Gateway (pathRewrite strips /api/community)
app.use('/answers', qaRoutes); // For API Gateway (pathRewrite strips /api/community)
app.use('/', communityRoutes); // Catch-all for root-level routes from proxy
app.use('/', commentRoutes); // Catch-all for comments routes from proxy
app.use('/', reportRoutes); // Catch-all for reports routes from proxy
app.use('/', qaRoutes); // Catch-all for Q&A routes from proxy

// Health check endpoint
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

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⚠️ Received SIGINT, shutting down gracefully...');
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during shutdown:', err);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️ Received SIGTERM, shutting down gracefully...');
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during shutdown:', err);
    process.exit(1);
  }
});

// Start server
const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log(`🚀 Community Service running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🖼️ Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME}`);
  console.log('='.repeat(50) + '\n');
});

module.exports = app;
