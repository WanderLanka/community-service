const axios = require('axios');

const ITINERARY_SERVICE_URL = process.env.ITINERARY_SERVICE_URL || 'http://localhost:3008';

/**
 * Extract unique locations from user's itineraries
 * @param {Array} itineraries - User's itineraries
 * @returns {Array} Array of unique location names
 */
const extractLocationsFromItineraries = (itineraries) => {
  const locations = new Set();
  
  itineraries.forEach(itinerary => {
    // Add start and end locations
    if (itinerary.startLocation?.name) {
      locations.add(itinerary.startLocation.name.toLowerCase().trim());
    }
    if (itinerary.endLocation?.name) {
      locations.add(itinerary.endLocation.name.toLowerCase().trim());
    }
    
    // Add places from day plans
    if (itinerary.dayPlans && Array.isArray(itinerary.dayPlans)) {
      itinerary.dayPlans.forEach(day => {
        // Places
        if (day.places && Array.isArray(day.places)) {
          day.places.forEach(place => {
            if (place.name) {
              locations.add(place.name.toLowerCase().trim());
            }
            if (place.address) {
              // Extract city from address
              const city = place.address.split(',')[0]?.toLowerCase().trim();
              if (city) locations.add(city);
            }
          });
        }
        
        // Accommodation locations
        if (day.accommodation?.address) {
          const city = day.accommodation.address.split(',')[0]?.toLowerCase().trim();
          if (city) locations.add(city);
        }
      });
    }
    
    // Add destinations if any
    if (itinerary.destinations && Array.isArray(itinerary.destinations)) {
      itinerary.destinations.forEach(dest => {
        if (dest.name) {
          locations.add(dest.name.toLowerCase().trim());
        }
      });
    }
  });
  
  return Array.from(locations);
};

/**
 * Extract user preferences from itineraries
 * @param {Array} itineraries - User's itineraries
 * @returns {Object} User preferences
 */
const extractUserPreferences = (itineraries) => {
  const preferences = {
    budgetTypes: new Set(),
    accommodationTypes: new Set(),
    transportationTypes: new Set(),
    tags: new Set()
  };
  
  itineraries.forEach(itinerary => {
    if (itinerary.preferences?.budget) {
      preferences.budgetTypes.add(itinerary.preferences.budget);
    }
    if (itinerary.preferences?.accommodation) {
      preferences.accommodationTypes.add(itinerary.preferences.accommodation);
    }
    if (itinerary.preferences?.transportation) {
      preferences.transportationTypes.add(itinerary.preferences.transportation);
    }
  });
  
  return {
    budgetTypes: Array.from(preferences.budgetTypes),
    accommodationTypes: Array.from(preferences.accommodationTypes),
    transportationTypes: Array.from(preferences.transportationTypes)
  };
};

/**
 * Calculate engagement score for a post
 * @param {Object} post - Blog post
 * @returns {Number} Engagement score
 */
const calculateEngagementScore = (post) => {
  const likesWeight = 3;
  const commentsWeight = 5;
  const viewsWeight = 0.1;
  
  const likesScore = (post.likesCount || 0) * likesWeight;
  const commentsScore = (post.commentsCount || 0) * commentsWeight;
  const viewsScore = (post.viewsCount || 0) * viewsWeight;
  
  return likesScore + commentsScore + viewsScore;
};

/**
 * Calculate recency score (newer posts get higher scores)
 * @param {Date} createdAt - Post creation date
 * @returns {Number} Recency score (0-100)
 */
const calculateRecencyScore = (createdAt) => {
  const now = new Date();
  const postDate = new Date(createdAt);
  const daysDiff = (now - postDate) / (1000 * 60 * 60 * 24);
  
  // Posts within 7 days get max score
  if (daysDiff <= 7) return 100;
  // Posts within 30 days get decreasing score
  if (daysDiff <= 30) return 100 - ((daysDiff - 7) * 2);
  // Posts within 90 days get lower score
  if (daysDiff <= 90) return 50 - ((daysDiff - 30) * 0.5);
  // Older posts get minimal score
  return Math.max(0, 20 - (daysDiff - 90) * 0.1);
};

/**
 * Check if location matches (fuzzy matching)
 * @param {String} postLocation - Post location name
 * @param {Array} userLocations - User's visited locations
 * @returns {Boolean} True if match found
 */
const isLocationMatch = (postLocation, userLocations) => {
  if (!postLocation) return false;
  
  const postLoc = postLocation.toLowerCase().trim();
  
  return userLocations.some(userLoc => {
    // Direct match
    if (postLoc.includes(userLoc) || userLoc.includes(postLoc)) {
      return true;
    }
    
    // Check if post location contains user location as a city
    const postParts = postLoc.split(',').map(p => p.trim());
    return postParts.some(part => part === userLoc || userLoc.includes(part));
  });
};

/**
 * Calculate personalized score for a post based on user itineraries
 * @param {Object} post - Blog post
 * @param {Array} userLocations - User's visited locations
 * @param {Object} userPreferences - User's travel preferences
 * @returns {Number} Personalized score
 */
const calculatePersonalizedScore = (post, userLocations, userPreferences) => {
  let score = 0;
  
  // 1. Location match (highest weight)
  if (isLocationMatch(post.location?.name, userLocations)) {
    score += 100;
  }
  
  // 2. Tag matching (medium weight)
  if (post.tags && Array.isArray(post.tags)) {
    const relevantTags = ['experience', 'tips', 'guide', 'adventure', 'food', 'culture'];
    const matchingTags = post.tags.filter(tag => relevantTags.includes(tag.toLowerCase()));
    score += matchingTags.length * 15;
  }
  
  // 3. Engagement score (medium weight)
  score += calculateEngagementScore(post) * 0.5;
  
  // 4. Recency score (low-medium weight)
  score += calculateRecencyScore(post.createdAt) * 0.3;
  
  // 5. Bonus for posts with images
  if (post.images && post.images.length > 0) {
    score += 10;
  }
  
  // 6. Penalty for flagged posts
  if (post.isFlagged) {
    score *= 0.5;
  }
  
  return score;
};

/**
 * Calculate generic score for posts (when user has no itineraries)
 * @param {Object} post - Blog post
 * @returns {Number} Generic score
 */
const calculateGenericScore = (post) => {
  let score = 0;
  
  // 1. Engagement score (highest weight for generic)
  score += calculateEngagementScore(post);
  
  // 2. Recency score
  score += calculateRecencyScore(post.createdAt) * 0.5;
  
  // 3. Bonus for popular Sri Lankan locations
  const popularLocations = [
    'colombo', 'kandy', 'galle', 'ella', 'sigiriya', 'nuwara eliya',
    'mirissa', 'unawatuna', 'arugam bay', 'yala', 'trincomalee'
  ];
  
  if (post.location?.name) {
    const postLoc = post.location.name.toLowerCase();
    if (popularLocations.some(loc => postLoc.includes(loc))) {
      score += 30;
    }
  }
  
  // 4. Tag diversity bonus
  if (post.tags && post.tags.length > 0) {
    score += post.tags.length * 5;
  }
  
  // 5. Image bonus
  if (post.images && post.images.length > 0) {
    score += 15;
  }
  
  // 6. Penalty for flagged posts
  if (post.isFlagged) {
    score *= 0.3;
  }
  
  return score;
};

/**
 * Fetch user's itineraries from itinerary service
 * @param {String} userId - User ID
 * @param {String} accessToken - User's access token for authentication
 * @returns {Array} User's itineraries
 */
const fetchUserItineraries = async (userId, accessToken = null) => {
  try {
    // If no access token provided, we can't fetch itineraries
    if (!accessToken) {
      console.log('⚠️ No access token provided, cannot fetch itineraries');
      return [];
    }
    
    const response = await axios.get(`${ITINERARY_SERVICE_URL}/api/itineraries/user`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 5000
    });
    
    if (response.data && response.data.success && response.data.data) {
      return response.data.data;
    }
    return [];
  } catch (error) {
    console.error('Error fetching user itineraries:', error.message);
    return [];
  }
};

/**
 * Get recommended posts for a user
 * @param {Object} BlogPost - BlogPost model
 * @param {String} userId - User ID
 * @param {Object} options - Options (limit, skip, accessToken)
 * @returns {Array} Recommended posts with scores
 */
const getRecommendedPosts = async (BlogPost, userId, options = {}) => {
  const { limit = 20, skip = 0, accessToken = null } = options;
  
  try {
    // 1. Fetch user's itineraries
    const itineraries = await fetchUserItineraries(userId, accessToken);
    
    // 2. Fetch all published posts (exclude user's own posts and hidden posts)
    const posts = await BlogPost.find({
      status: 'published',
      'author.userId': { $ne: userId },
      hiddenBy: { $ne: userId }
    })
    .lean()
    .limit(500) // Fetch more posts for better recommendations
    .sort({ createdAt: -1 });
    
    let scoredPosts;
    
    if (itineraries && itineraries.length > 0) {
      // **PERSONALIZED RECOMMENDATIONS** (User has itineraries)
      console.log(`📊 Generating personalized recommendations for user ${userId} with ${itineraries.length} itineraries`);
      
      const userLocations = extractLocationsFromItineraries(itineraries);
      const userPreferences = extractUserPreferences(itineraries);
      
      console.log(`📍 User locations: ${userLocations.join(', ')}`);
      
      scoredPosts = posts.map(post => ({
        post,
        score: calculatePersonalizedScore(post, userLocations, userPreferences)
      }));
      
    } else {
      // **GENERIC RECOMMENDATIONS** (User has no itineraries)
      console.log(`📊 Generating generic recommendations for user ${userId} (no itineraries)`);
      
      scoredPosts = posts.map(post => ({
        post,
        score: calculateGenericScore(post)
      }));
    }
    
    // 3. Sort by score and apply pagination
    scoredPosts.sort((a, b) => b.score - a.score);
    
    const recommendedPosts = scoredPosts
      .slice(skip, skip + limit)
      .map(item => item.post);
    
    console.log(`✅ Recommended ${recommendedPosts.length} posts (scores: ${scoredPosts.slice(skip, skip + limit).map(s => s.score.toFixed(1)).join(', ')})`);
    
    return recommendedPosts;
    
  } catch (error) {
    console.error('Error generating recommendations:', error);
    // Fallback: Return recent posts
    return await BlogPost.find({
      status: 'published',
      'author.userId': { $ne: userId },
      hiddenBy: { $ne: userId }
    })
    .limit(limit)
    .skip(skip)
    .sort({ createdAt: -1 })
    .lean();
  }
};

module.exports = {
  getRecommendedPosts,
  extractLocationsFromItineraries,
  extractUserPreferences,
  calculateEngagementScore,
  calculateRecencyScore,
  calculatePersonalizedScore,
  calculateGenericScore
};
