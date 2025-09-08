const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const auth = require('../middleware/auth');
const { 
  requireAdmin, 
  requireSuperAdmin, 
  requirePermission,
  adminRateLimit,
  logAdminAction 
} = require('../middleware/admin');
const { validate } = require('../middleware/validation');

// Import controllers
const adminController = require('../controllers/adminController');
const adminProductController = require('../controllers/admin/productController');
const adminUserController = require('../controllers/admin/userController');
const adminOrderController = require('../controllers/admin/orderController');
const adminAnalyticsController = require('../controllers/admin/analyticsController');

// Apply auth and admin middleware to all routes
router.use(auth);
router.use(requireAdmin);
router.use(adminRateLimit(200, 15 * 60 * 1000)); // 200 requests per 15 minutes

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     adminAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: Admin JWT token required
 */

/**
 * Dashboard and Analytics Routes
 */

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Get admin dashboard data
 *     tags: [Admin]
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *       403:
 *         description: Admin access required
 */
router.get('/dashboard', 
  logAdminAction('view_dashboard'),
  adminController.getDashboard
);

/**
 * @swagger
 * /api/admin/analytics:
 *   get:
 *     summary: Get detailed analytics
 *     tags: [Admin]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, week, month, quarter, year]
 *         description: Analytics period
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for custom period
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for custom period
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 */
router.get('/analytics',
  [
    query('period').optional().isIn(['day', 'week', 'month', 'quarter', 'year']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    validate
  ],
  logAdminAction('view_analytics'),
  adminAnalyticsController.getAnalytics
);

/**
 * User Management Routes
 */

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all users with pagination
 *     tags: [Admin - Users]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or email
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [user, admin, super_admin]
 *         description: Filter by user role
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 */
router.get('/users',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('search').optional().isString(),
    query('role').optional().isIn(['user', 'admin', 'super_admin']),
    validate
  ],
  requirePermission('manage_users'),
  logAdminAction('view_users'),
  adminUserController.getUsers
);

/**
 * @swagger
 * /api/admin/users/{userId}:
 *   get:
 *     summary: Get user details
 *     tags: [Admin - Users]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User details retrieved successfully
 *       404:
 *         description: User not found
 */
router.get('/users/:userId',
  [
    param('userId').isMongoId().withMessage('Invalid user ID'),
    validate
  ],
  requirePermission('manage_users'),
  logAdminAction('view_user_details'),
  adminUserController.getUserDetails
);

/**
 * @swagger
 * /api/admin/users/{userId}:
 *   put:
 *     summary: Update user
 *     tags: [Admin - Users]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               role:
 *                 type: string
 *                 enum: [user, admin, super_admin]
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User updated successfully
 */
router.put('/users/:userId',
  [
    param('userId').isMongoId().withMessage('Invalid user ID'),
    body('firstName').optional().isString().trim(),
    body('lastName').optional().isString().trim(),
    body('email').optional().isEmail().normalizeEmail(),
    body('role').optional().isIn(['user', 'admin', 'super_admin']),
    body('isActive').optional().isBoolean(),
    validate
  ],
  requirePermission('manage_users'),
  logAdminAction('update_user'),
  adminUserController.updateUser
);

/**
 * Product Management Routes
 */

/**
 * @swagger
 * /api/admin/products:
 *   get:
 *     summary: Get all products for admin
 *     tags: [Admin - Products]
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 */
router.get('/products',
  requirePermission('manage_products'),
  logAdminAction('view_products'),
  adminProductController.getProducts
);

/**
 * @swagger
 * /api/admin/products:
 *   post:
 *     summary: Create new product
 *     tags: [Admin - Products]
 *     security:
 *       - adminAuth: []
 *     responses:
 *       201:
 *         description: Product created successfully
 */
router.post('/products',
  requirePermission('manage_products'),
  logAdminAction('create_product'),
  adminProductController.createProduct
);

/**
 * @swagger
 * /api/admin/products/{productId}:
 *   put:
 *     summary: Update product
 *     tags: [Admin - Products]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product updated successfully
 */
router.put('/products/:productId',
  [
    param('productId').isMongoId().withMessage('Invalid product ID'),
    validate
  ],
  requirePermission('manage_products'),
  logAdminAction('update_product'),
  adminProductController.updateProduct
);

/**
 * @swagger
 * /api/admin/products/{productId}:
 *   delete:
 *     summary: Delete product
 *     tags: [Admin - Products]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product deleted successfully
 */
router.delete('/products/:productId',
  [
    param('productId').isMongoId().withMessage('Invalid product ID'),
    validate
  ],
  requirePermission('manage_products'),
  logAdminAction('delete_product'),
  adminProductController.deleteProduct
);

/**
 * Order Management Routes
 */

/**
 * @swagger
 * /api/admin/orders:
 *   get:
 *     summary: Get all orders for admin
 *     tags: [Admin - Orders]
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Orders retrieved successfully
 */
router.get('/orders',
  requirePermission('manage_orders'),
  logAdminAction('view_orders'),
  adminOrderController.getOrders
);

/**
 * @swagger
 * /api/admin/orders/{orderId}/status:
 *   put:
 *     summary: Update order status
 *     tags: [Admin - Orders]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, confirmed, processing, shipped, delivered, cancelled, refunded]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Order status updated successfully
 */
router.put('/orders/:orderId/status',
  [
    param('orderId').isMongoId().withMessage('Invalid order ID'),
    body('status').isIn(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']),
    body('notes').optional().isString().trim(),
    validate
  ],
  requirePermission('manage_orders'),
  logAdminAction('update_order_status'),
  adminOrderController.updateOrderStatus
);

/**
 * @swagger
 * /api/admin/orders/{orderId}/shipping:
 *   put:
 *     summary: Update order shipping information
 *     tags: [Admin - Orders]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trackingNumber:
 *                 type: string
 *               carrier:
 *                 type: string
 *                 enum: [ups, fedex, usps, dhl]
 *               trackingUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Shipping information updated successfully
 */
router.put('/orders/:orderId/shipping',
  [
    param('orderId').isMongoId().withMessage('Invalid order ID'),
    body('trackingNumber').optional().isString().trim(),
    body('carrier').optional().isIn(['ups', 'fedex', 'usps', 'dhl']),
    body('trackingUrl').optional().isURL(),
    validate
  ],
  requirePermission('manage_orders'),
  logAdminAction('update_order_shipping'),
  adminOrderController.updateShipping
);

/**
 * System Management Routes (Super Admin Only)
 */

/**
 * @swagger
 * /api/admin/system/stats:
 *   get:
 *     summary: Get system statistics
 *     tags: [Admin - System]
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: System statistics retrieved successfully
 */
router.get('/system/stats',
  requireSuperAdmin,
  logAdminAction('view_system_stats'),
  adminController.getSystemStats
);

/**
 * @swagger
 * /api/admin/system/logs:
 *   get:
 *     summary: Get system logs
 *     tags: [Admin - System]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [error, warn, info, debug]
 *         description: Log level filter
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *         description: Number of log entries to retrieve
 *     responses:
 *       200:
 *         description: System logs retrieved successfully
 */
router.get('/system/logs',
  [
    query('level').optional().isIn(['error', 'warn', 'info', 'debug']),
    query('limit').optional().isInt({ min: 1, max: 1000 }),
    validate
  ],
  requireSuperAdmin,
  logAdminAction('view_system_logs'),
  adminController.getSystemLogs
);

/**
 * @swagger
 * /api/admin/system/backup:
 *   post:
 *     summary: Trigger system backup
 *     tags: [Admin - System]
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Backup initiated successfully
 */
router.post('/system/backup',
  requireSuperAdmin,
  logAdminAction('trigger_system_backup'),
  adminController.triggerBackup
);

module.exports = router;