const cloudinary = require('cloudinary').v2;
require('dotenv').config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload image to Cloudinary with optimization
 * @param {string} filePath - Path to the file to upload
 * @param {string} folder - Cloudinary folder name
 * @returns {Promise<Object>} Upload result with URL and public_id
 */
const uploadImage = async (filePath, folder = 'wanderlanka/community') => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: folder,
      resource_type: 'auto',
      // Optimization settings
      transformation: [
        { quality: 'auto:good' }, // Automatic quality optimization
        { fetch_format: 'auto' }, // Automatic format selection (WebP, AVIF, etc.)
      ],
      // Generate multiple sizes for responsive images
      eager: [
        { width: 800, height: 600, crop: 'limit' }, // Large
        { width: 400, height: 300, crop: 'limit' }, // Medium
        { width: 200, height: 150, crop: 'limit' }  // Thumbnail
      ],
      eager_async: true // Generate transformations asynchronously
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      thumbnailUrl: result.eager?.[2]?.secure_url || result.secure_url,
      mediumUrl: result.eager?.[1]?.secure_url || result.secure_url,
      largeUrl: result.eager?.[0]?.secure_url || result.secure_url,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error(`Image upload failed: ${error.message}`);
  }
};

/**
 * Upload multiple images to Cloudinary
 * @param {Array<string>} filePaths - Array of file paths
 * @param {string} folder - Cloudinary folder name
 * @returns {Promise<Array<Object>>} Array of upload results
 */
const uploadMultipleImages = async (filePaths, folder = 'wanderlanka/community') => {
  try {
    const uploadPromises = filePaths.map(filePath => uploadImage(filePath, folder));
    return await Promise.all(uploadPromises);
  } catch (error) {
    console.error('Multiple images upload error:', error);
    throw new Error(`Multiple images upload failed: ${error.message}`);
  }
};

/**
 * Delete image from Cloudinary
 * @param {string} publicId - Cloudinary public_id of the image
 * @returns {Promise<Object>} Deletion result
 */
const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error(`Image deletion failed: ${error.message}`);
  }
};

/**
 * Delete multiple images from Cloudinary
 * @param {Array<string>} publicIds - Array of Cloudinary public_ids
 * @returns {Promise<Array<Object>>} Array of deletion results
 */
const deleteMultipleImages = async (publicIds) => {
  try {
    const deletePromises = publicIds.map(publicId => deleteImage(publicId));
    return await Promise.all(deletePromises);
  } catch (error) {
    console.error('Multiple images delete error:', error);
    throw new Error(`Multiple images deletion failed: ${error.message}`);
  }
};

/**
 * Get optimized image URL with transformations
 * @param {string} publicId - Cloudinary public_id
 * @param {Object} options - Transformation options
 * @returns {string} Transformed image URL
 */
const getOptimizedImageUrl = (publicId, options = {}) => {
  const {
    width = 800,
    height = 600,
    crop = 'limit',
    quality = 'auto:good',
    format = 'auto'
  } = options;

  return cloudinary.url(publicId, {
    transformation: [
      { width, height, crop },
      { quality },
      { fetch_format: format }
    ],
    secure: true
  });
};

module.exports = {
  cloudinary,
  uploadImage,
  uploadMultipleImages,
  deleteImage,
  deleteMultipleImages,
  getOptimizedImageUrl
};
