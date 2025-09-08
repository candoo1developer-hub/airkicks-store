const User = require('../models/User');
const logger = require('../config/logger');

/**
 * Admin authentication middleware
 * Checks if user is authenticated and has admin role
 */
const requireAdmin = async (req, res, next) => {
  try {
    // Check if user is authenticated (auth middleware should run first)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user has admin role
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      logger.warn(`Non-admin user ${req.user.id} attempted to access admin endpoint`, {
        userId: req.user.id,
        email: req.user.email,
        role: req.user.role,
        endpoint: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    // Log admin access for security auditing
    logger.info(`Admin access granted`, {
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role,
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    next();
  } catch (error) {
    logger.error('Admin middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Super admin middleware
 * Checks if user has super admin privileges
 */
const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (req.user.role !== 'super_admin') {
      logger.warn(`Non-super-admin user attempted super admin access`, {
        userId: req.user.id,
        email: req.user.email,
        role: req.user.role,
        endpoint: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        message: 'Super admin access required'
      });
    }

    logger.info(`Super admin access granted`, {
      userId: req.user.id,
      email: req.user.email,
      endpoint: req.path,
      method: req.method,
      ip: req.ip
    });

    next();
  } catch (error) {
    logger.error('Super admin middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Permission-based access control middleware
 * Checks specific permissions for more granular control
 */
const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Super admins have all permissions
      if (req.user.role === 'super_admin') {
        return next();
      }

      // Check if user has the required permission
      if (!req.user.permissions || !req.user.permissions.includes(permission)) {
        logger.warn(`User lacks required permission`, {
          userId: req.user.id,
          email: req.user.email,
          role: req.user.role,
          requiredPermission: permission,
          userPermissions: req.user.permissions,
          endpoint: req.path,
          method: req.method,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          message: `Permission required: ${permission}`
        });
      }

      next();
    } catch (error) {
      logger.error('Permission middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  };
};

/**
 * Resource ownership middleware
 * Checks if user owns the resource or has admin privileges
 */
const requireOwnershipOrAdmin = (resourceField = 'user') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Admins can access any resource
      if (req.user.role === 'admin' || req.user.role === 'super_admin') {
        return next();
      }

      // Check resource ownership
      const resourceId = req.params.id;
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          message: 'Resource ID required'
        });
      }

      // The resource should be populated in the route handler
      // This middleware assumes the resource is checked in the route
      req.requireOwnershipCheck = {
        userId: req.user.id,
        resourceField
      };

      next();
    } catch (error) {
      logger.error('Ownership middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  };
};

/**
 * Rate limiting for admin actions
 */
const adminRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();

  return (req, res, next) => {
    if (!req.user) {
      return next();
    }

    const key = req.user.id;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    if (requests.has(key)) {
      const userRequests = requests.get(key).filter(time => time > windowStart);
      requests.set(key, userRequests);
    } else {
      requests.set(key, []);
    }

    const userRequests = requests.get(key);

    if (userRequests.length >= maxRequests) {
      logger.warn(`Admin rate limit exceeded`, {
        userId: req.user.id,
        email: req.user.email,
        requests: userRequests.length,
        maxRequests,
        windowMs,
        endpoint: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    userRequests.push(now);
    requests.set(key, userRequests);
    next();
  };
};

/**
 * Admin action logging middleware
 */
const logAdminAction = (action) => {
  return (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Log the admin action
      logger.info(`Admin action performed: ${action}`, {
        userId: req.user?.id,
        email: req.user?.email,
        role: req.user?.role,
        action,
        endpoint: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestBody: req.method !== 'GET' ? req.body : undefined,
        statusCode: res.statusCode,
        timestamp: new Date().toISOString()
      });

      originalSend.call(this, data);
    };

    next();
  };
};

module.exports = {
  requireAdmin,
  requireSuperAdmin,
  requirePermission,
  requireOwnershipOrAdmin,
  adminRateLimit,
  logAdminAction
};