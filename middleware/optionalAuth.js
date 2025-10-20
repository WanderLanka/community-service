const jwt = require('jsonwebtoken');

/**
 * Optional authentication middleware
 * Attempts to verify JWT token if provided, but allows request to continue even without token
 * If token is valid, user info is attached to req.user
 * If no token or invalid token, req.user will be undefined
 */
const optionalAuth = (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    // If no auth header, continue without user info
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = undefined;
      return next();
    }

    // Extract token
    const token = authHeader.split(' ')[1];

    if (!token) {
      req.user = undefined;
      return next();
    }

    // Try to verify token
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Attach user info to request
      req.user = {
        userId: decoded.userId,
        username: decoded.username,
        email: decoded.email,
        role: decoded.role,
        platform: decoded.platform
      };

      console.log(`🔐 Optional auth - authenticated user: ${req.user.username} (${req.user.role})`);
    } catch (error) {
      // Token verification failed, but we continue anyway
      console.log(`⚠️  Optional auth - invalid token, continuing without user info`);
      req.user = undefined;
    }

    next();
  } catch (error) {
    // Any other error, continue without user info
    console.error('Optional auth error:', error.message);
    req.user = undefined;
    next();
  }
};

module.exports = optionalAuth;
