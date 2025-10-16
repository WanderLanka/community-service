# WanderLanka Community Service

The Community Service is a microservice for the WanderLanka platform that handles travel blog posts, social interactions (likes and comments), and efficient image management using both MongoDB and Cloudinary CDN.

## Features

- ✍️ **Travel Blog Posts**: Create, read, update, and delete travel blog posts
- 📸 **Efficient Image Storage**: Dual storage strategy using MongoDB (metadata) and Cloudinary (CDN)
- 🖼️ **Responsive Images**: Automatic generation of multiple image sizes (thumbnail, medium, large)
- 🌐 **Image Optimization**: Automatic format conversion (WebP/AVIF), quality optimization
- ❤️ **Social Features**: Like/unlike posts, add/remove comments
- 🔐 **JWT Authentication**: Secure routes with token-based authentication
- 🔍 **Advanced Filtering**: Sort by recent, popular, trending; filter by author and tags
- 📊 **Pagination**: Efficient data loading with pagination support
- 🚦 **Rate Limiting**: Protection against abuse with request limits
- 📈 **View Tracking**: Automatic view count increment

## Tech Stack

- **Runtime**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **Image CDN**: Cloudinary
- **File Upload**: Multer
- **Authentication**: JWT (JSON Web Tokens)
- **Security**: Helmet, CORS, express-rate-limit
- **Validation**: express-validator

## Installation

1. **Navigate to the service directory**:
   ```bash
   cd community-service
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   - Copy `.env.example` to `.env`
   - Update the values with your configuration:
   ```bash
   cp .env.example .env
   ```

4. **Start the service**:
   ```bash
   # Development mode with auto-reload
   npm run dev

   # Production mode
   npm start
   ```

The service will start on port **3007** by default.

## Environment Variables

```env
# Server Configuration
PORT=3007
NODE_ENV=development

# MongoDB
MONGO_URI=mongodb://localhost:27017/wanderlanka

# JWT Secret (should match user-service)
JWT_SECRET=your_jwt_secret_key_here

# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=854478446649167
CLOUDINARY_API_SECRET=eARiWFRKkGgaUmrHp5Z9F19ZuHA

# CORS (comma-separated origins)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8081

# File Upload Limits
MAX_FILE_SIZE=10485760
MAX_FILES=5
```

## API Endpoints

### Health Check

#### `GET /health`
Check service health and database connection status.

**Response**:
```json
{
  "success": true,
  "service": "community-service",
  "status": "running",
  "uptime": 12345.67,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "database": "connected"
}
```

### Blog Posts

#### `GET /api/community/posts`
Get all published blog posts with pagination and filtering.

**Query Parameters**:
- `page` (optional, default: 1): Page number
- `limit` (optional, default: 10): Items per page
- `sort` (optional, default: "recent"): Sort order
  - `recent`: Latest posts first
  - `popular`: Most liked posts
  - `trending`: Popular posts from the last 7 days
- `authorId` (optional): Filter by author user ID
- `tag` (optional): Filter by tag

**Response**:
```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "author": {
          "userId": "507f191e810c19729de860ea",
          "username": "traveler123",
          "avatar": "https://...",
          "role": "traveller"
        },
        "title": "Amazing Sunrise at Sigiriya",
        "content": "The view from the top was absolutely breathtaking...",
        "tags": ["sigiriya", "sunrise", "unesco"],
        "location": {
          "name": "Sigiriya Rock Fortress",
          "coordinates": {
            "latitude": 7.9570,
            "longitude": 80.7603
          }
        },
        "images": [
          {
            "url": "https://res.cloudinary.com/.../image.jpg",
            "publicId": "wanderlanka/posts/abc123",
            "thumbnailUrl": "https://res.cloudinary.com/.../w_200,h_150/...",
            "mediumUrl": "https://res.cloudinary.com/.../w_400,h_300/...",
            "largeUrl": "https://res.cloudinary.com/.../w_800,h_600/...",
            "metadata": {
              "width": 1920,
              "height": 1080,
              "format": "jpg",
              "size": 245678
            }
          }
        ],
        "likesCount": 45,
        "commentsCount": 12,
        "viewsCount": 320,
        "isLikedByUser": false,
        "status": "published",
        "createdAt": "2024-01-15T08:00:00.000Z",
        "updatedAt": "2024-01-15T08:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalPosts": 47,
      "hasMore": true
    }
  }
}
```

#### `GET /api/community/posts/:id`
Get a single blog post by ID. Increments view count automatically.

**Response**:
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "author": { /* ... */ },
    "title": "Amazing Sunrise at Sigiriya",
    "content": "...",
    "images": [ /* ... */ ],
    "likes": [
      {
        "userId": "507f191e810c19729de860ea",
        "username": "user1",
        "likedAt": "2024-01-15T09:00:00.000Z"
      }
    ],
    "comments": [
      {
        "_id": "507f1f77bcf86cd799439012",
        "user": {
          "userId": "507f191e810c19729de860eb",
          "username": "commenter1",
          "avatar": "https://..."
        },
        "content": "Great photos!",
        "createdAt": "2024-01-15T10:00:00.000Z"
      }
    ],
    "isLikedByUser": true
  }
}
```

#### `POST /api/community/posts`
Create a new blog post with images.

**Authentication**: Required (JWT token)

**Content-Type**: `multipart/form-data`

**Form Fields**:
- `title` (required): Post title (3-200 characters)
- `content` (required): Post content (10-5000 characters)
- `tags` (optional): Array of tags
- `locationName` (optional): Location name
- `latitude` (optional): Location latitude
- `longitude` (optional): Location longitude
- `images` (optional): Up to 5 image files (max 10MB each)

**Example using cURL**:
```bash
curl -X POST http://localhost:3007/api/community/posts \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "title=My Amazing Trip to Ella" \
  -F "content=The train ride to Ella was one of the most scenic journeys I've ever experienced..." \
  -F "tags[]=ella" \
  -F "tags[]=train" \
  -F "tags[]=scenery" \
  -F "locationName=Ella, Sri Lanka" \
  -F "latitude=6.8667" \
  -F "longitude=81.0467" \
  -F "images=@photo1.jpg" \
  -F "images=@photo2.jpg"
```

**Example using JavaScript (fetch)**:
```javascript
const formData = new FormData();
formData.append('title', 'My Amazing Trip to Ella');
formData.append('content', 'The train ride was incredible...');
formData.append('tags', JSON.stringify(['ella', 'train', 'scenery']));
formData.append('locationName', 'Ella, Sri Lanka');
formData.append('latitude', '6.8667');
formData.append('longitude', '81.0467');

// Add multiple images
imageFiles.forEach(file => {
  formData.append('images', file);
});

const response = await fetch('http://localhost:3007/api/community/posts', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

const data = await response.json();
```

**Response**:
```json
{
  "success": true,
  "message": "Blog post created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439013",
    "author": { /* ... */ },
    "title": "My Amazing Trip to Ella",
    "content": "...",
    "images": [ /* Cloudinary URLs with multiple sizes */ ],
    "createdAt": "2024-01-15T11:00:00.000Z"
  }
}
```

#### `PUT /api/community/posts/:id`
Update an existing blog post.

**Authentication**: Required (must be post author)

**Request Body**:
```json
{
  "title": "Updated Title",
  "content": "Updated content...",
  "tags": ["updated", "tags"],
  "locationName": "New Location",
  "latitude": 7.8731,
  "longitude": 80.7718
}
```

**Response**:
```json
{
  "success": true,
  "message": "Post updated successfully",
  "data": { /* Updated post */ }
}
```

#### `DELETE /api/community/posts/:id`
Delete a blog post and its images from Cloudinary.

**Authentication**: Required (must be post author)

**Response**:
```json
{
  "success": true,
  "message": "Post deleted successfully"
}
```

#### `GET /api/community/posts/user/:userId`
Get all posts by a specific user.

**Query Parameters**:
- `page` (optional): Page number
- `limit` (optional): Items per page

**Response**: Similar to `GET /api/community/posts`

### Social Features

#### `POST /api/community/posts/:id/like`
Like a blog post.

**Authentication**: Required

**Response**:
```json
{
  "success": true,
  "message": "Post liked successfully",
  "data": {
    "likesCount": 46
  }
}
```

#### `DELETE /api/community/posts/:id/like`
Unlike a blog post.

**Authentication**: Required

**Response**:
```json
{
  "success": true,
  "message": "Post unliked successfully",
  "data": {
    "likesCount": 45
  }
}
```

#### `POST /api/community/posts/:id/comments`
Add a comment to a blog post.

**Authentication**: Required

**Request Body**:
```json
{
  "content": "Great post! Thanks for sharing."
}
```

**Response**:
```json
{
  "success": true,
  "message": "Comment added successfully",
  "data": {
    "comment": {
      "_id": "507f1f77bcf86cd799439014",
      "user": {
        "userId": "507f191e810c19729de860ec",
        "username": "commenter2",
        "avatar": "https://..."
      },
      "content": "Great post! Thanks for sharing.",
      "createdAt": "2024-01-15T12:00:00.000Z"
    },
    "commentsCount": 13
  }
}
```

#### `DELETE /api/community/posts/:id/comments/:commentId`
Delete a comment from a blog post.

**Authentication**: Required (must be comment author or post author)

**Response**:
```json
{
  "success": true,
  "message": "Comment deleted successfully",
  "data": {
    "commentsCount": 12
  }
}
```

## Image Storage Strategy

This service implements an efficient dual storage strategy:

### 1. Cloudinary (CDN)
- Stores actual image files
- Automatic optimization (WebP/AVIF conversion, quality optimization)
- Generates 3 responsive sizes:
  - **Thumbnail**: 200x150px (for lists/previews)
  - **Medium**: 400x300px (for cards/feeds)
  - **Large**: 800x600px (for detail views)
- Global CDN delivery for fast loading

### 2. MongoDB
- Stores image metadata only:
  - Cloudinary public ID (for deletion)
  - URLs for all sizes
  - Original image dimensions
  - File format and size

### Benefits
- **Performance**: Fast image delivery via Cloudinary's CDN
- **Efficiency**: MongoDB stores only lightweight metadata (~200 bytes per image)
- **Scalability**: No storage bottlenecks on the application server
- **Optimization**: Automatic format and quality optimization
- **Responsive**: Multiple sizes for different use cases
- **Management**: Easy cleanup - deleting a post removes both DB records and Cloudinary files

## Authentication

All protected routes require a JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

The JWT token should be obtained from the **user-service** after successful login. The token contains:
- `userId`: User's unique identifier
- `username`: User's username
- `role`: User role (traveller, guide, admin)
- `avatar`: User's avatar URL (optional)

## Rate Limiting

The service implements rate limiting to prevent abuse:

- **General API**: 100 requests per 15 minutes per IP
- **Post Creation**: 10 posts per hour per IP

## Error Handling

All errors follow a consistent format:

```json
{
  "success": false,
  "message": "Error description",
  "errors": [ /* Validation errors array (if applicable) */ ]
}
```

### Common HTTP Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (missing/invalid token)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `429`: Too Many Requests (rate limit exceeded)
- `500`: Internal Server Error

## Database Indexes

The BlogPost model includes optimized indexes for better query performance:

- `author.userId` + `createdAt` (compound index for user posts)
- `createdAt` (descending, for recent posts)
- `likesCount` (descending, for popular posts)
- `tags` (for tag filtering)
- `status` + `createdAt` (compound index for published posts)

## Development

### Running Tests
```bash
npm test
```

### Linting
```bash
npm run lint
```

### File Structure
```
community-service/
├── config/
│   └── cloudinary.js       # Cloudinary configuration and utilities
├── middleware/
│   ├── auth.js             # JWT authentication middleware
│   └── upload.js           # Multer file upload configuration
├── models/
│   └── BlogPost.js         # MongoDB schema for blog posts
├── routes/
│   └── communityRoutes.js  # API route definitions
├── uploads/                # Temporary upload directory (auto-created)
├── .env                    # Environment variables (not in git)
├── .env.example            # Environment variables template
├── .gitignore              # Git ignore rules
├── index.js                # Server entry point
├── package.json            # Dependencies and scripts
└── README.md               # This file
```

## Integration with Mobile App

### React Native / Expo Example

```javascript
import * as ImagePicker from 'expo-image-picker';

// Create a post with images
const createPost = async (title, content, tags, location, images) => {
  const formData = new FormData();
  formData.append('title', title);
  formData.append('content', content);
  formData.append('tags', JSON.stringify(tags));
  
  if (location) {
    formData.append('locationName', location.name);
    formData.append('latitude', location.latitude.toString());
    formData.append('longitude', location.longitude.toString());
  }

  // Add images from ImagePicker
  images.forEach((image, index) => {
    formData.append('images', {
      uri: image.uri,
      type: image.type || 'image/jpeg',
      name: image.fileName || `photo_${index}.jpg`
    });
  });

  const token = await AsyncStorage.getItem('authToken');

  const response = await fetch('http://YOUR_SERVER:3007/api/community/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData
  });

  return response.json();
};

// Like a post
const likePost = async (postId) => {
  const token = await AsyncStorage.getItem('authToken');
  
  const response = await fetch(`http://YOUR_SERVER:3007/api/community/posts/${postId}/like`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    }
  });

  return response.json();
};
```

## Troubleshooting

### Port Already in Use
If port 3007 is already in use, either:
1. Change the `PORT` in `.env`
2. Find and kill the process using port 3007:
   ```bash
   lsof -ti:3007 | xargs kill -9
   ```

### MongoDB Connection Issues
- Ensure MongoDB is running: `brew services start mongodb-community`
- Check the `MONGO_URI` in `.env`
- Verify database permissions

### Cloudinary Upload Errors
- Verify `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `.env`
- Check Cloudinary account quotas and limits
- Ensure images meet size requirements (max 10MB)

### JWT Authentication Errors
- Ensure `JWT_SECRET` matches the one used by user-service
- Verify token is included in `Authorization` header
- Check token expiration

## Support

For issues or questions, please contact the development team or create an issue in the project repository.

## License

Copyright © 2024 WanderLanka. All rights reserved.
