const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-randomstring-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, JPG, PNG, GIF, WebP) are allowed!'), false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 5 // Maximum 5 files per request
  }
});

/**
 * Middleware to handle single image upload
 */
const uploadSingle = upload.single('image');

/**
 * Middleware to handle multiple image uploads
 */
const uploadMultiple = upload.array('images', 5); // Max 5 images

/**
 * Clean up uploaded files (used when upload fails after multer processing)
 * @param {Array<Object>} files - Array of file objects from multer
 */
const cleanupFiles = (files) => {
  if (!files || files.length === 0) return;
  
  const filesToDelete = Array.isArray(files) ? files : [files];
  filesToDelete.forEach(file => {
    if (file && file.path) {
      fs.unlink(file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }
  });
};

/**
 * Middleware to handle multer errors
 */
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 10MB per file.',
        error: err.message
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum is 5 files per upload.',
        error: err.message
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected field in file upload.',
        error: err.message
      });
    }
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      error: err.message
    });
  }
  
  // Other errors (file filter, etc.)
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Error uploading files'
    });
  }
  
  next();
};

module.exports = {
  uploadSingle,
  uploadMultiple,
  cleanupFiles,
  handleMulterError,
  uploadDir
};
