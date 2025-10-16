const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token
 */
const verifyToken = (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
        code: 'NO_TOKEN'
      });
    }

    // Extract token
    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Invalid token format.',
        code: 'INVALID_TOKEN_FORMAT'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      role: decoded.role,
      platform: decoded.platform
    };

    console.log(`🔐 Authenticated user: ${req.user.username} (${req.user.role})`);
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
        code: 'INVALID_TOKEN'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.',
        code: 'TOKEN_EXPIRED'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Middleware to verify user role
 * @param {Array<string>} allowedRoles - Array of allowed roles
 */
const verifyRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden. Insufficient permissions.',
        code: 'FORBIDDEN',
        requiredRole: allowedRoles,
        userRole: req.user.role
      });
    }

    next();
  };
};

/**
 * Optional authentication - attaches user if token is valid, but doesn't require it
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      role: decoded.role,
      platform: decoded.platform
    };

    next();
  } catch (error) {
    // If token is invalid, just proceed without user
    next();
  }
};

module.exports = {
  verifyToken,
  verifyRole,
  optionalAuth
};
