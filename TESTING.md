# WanderLanka Community Service - Testing Guide

## 🎉 Setup Complete!

The community service backend is now fully implemented and running. Here's what has been set up:

### ✅ Backend (Community Service)
- **Port**: 3007
- **Database**: MongoDB (`wanderlanka-community`)
- **Image CDN**: Cloudinary
- **Status**: Running ✅

### ✅ Mobile App Integration
- Updated `create-post.tsx` to send data to backend
- Implements FormData for image uploads
- Uses network detection for dynamic server URLs
- Shows loading indicator while posting

---

## 🧪 How to Test

### 1. Verify Service is Running

```bash
# Check health endpoint
curl http://localhost:3007/health

# Expected response:
{
  "success": true,
  "service": "community-service",
  "status": "running",
  "database": "connected"
}
```

### 2. Test from Mobile App

1. **Open the WanderLanka mobile app**
2. **Navigate to Community tab**
3. **Tap the "+" button to create a post**
4. **Fill in the form**:
   - Add a title (e.g., "Amazing Sunrise at Sigiriya")
   - Write content (e.g., "The view from the top was breathtaking...")
   - Add location (e.g., "Sigiriya, Sri Lanka")
   - Select images from your phone
   - Choose a category
5. **Tap "Share"**
6. **Watch the console logs**:
   - Should see "📤 Posting to community service..."
   - Should see the community service URL being used
   - Should see a success message

### 3. Verify Data was Saved

#### Check MongoDB:
```bash
# Open MongoDB shell
mongosh wanderlanka-community

# View all posts
db.blogposts.find().pretty()

# Count posts
db.blogposts.countDocuments()
```

#### Check Cloudinary:
1. Log in to Cloudinary dashboard: https://cloudinary.com/console
2. Go to Media Library
3. Look for folder: `wanderlanka/posts/`
4. You should see uploaded images with 3 sizes each:
   - Thumbnail (200x150)
   - Medium (400x300)
   - Large (800x600)

---

## 🔍 Troubleshooting

### Issue: "Network Error - Could not connect to the server"

**Solution**: Make sure both mobile app and community service are on the same network.

Check the console log for:
```
🌐 Using community service URL: http://[IP]:3007
```

Verify this IP matches your computer's IP:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### Issue: "Authentication Required"

**Solution**: Make sure you're logged in to the mobile app. The JWT token from login is required.

### Issue: Images not uploaded to Cloudinary

**Possible causes**:
1. **Incorrect Cloudinary credentials** - Check `.env` file
2. **Cloudinary quota exceeded** - Check your Cloudinary account
3. **Image file too large** - Max 10MB per image

**Fix for credentials**:
```bash
cd community-service
nano .env

# Update these lines:
CLOUDINARY_CLOUD_NAME=your_actual_cloud_name
CLOUDINARY_API_KEY=854478446649167
CLOUDINARY_API_SECRET=eARiWFRKkGgaUmrHp5Z9F19ZuHA
```

Then restart the service:
```bash
# Stop current service (Ctrl+C)
node index.js
```

### Issue: MongoDB connection failed

**Solution**: Start MongoDB service
```bash
brew services start mongodb-community
```

---

## 📊 Test with cURL (Without Mobile App)

### Get JWT Token First
```bash
# Login to get token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your_email@example.com",
    "password": "your_password"
  }'

# Copy the accessToken from response
```

### Create a Post
```bash
curl -X POST http://localhost:3007/api/community/posts \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN_HERE" \
  -F "title=Test Post from cURL" \
  -F "content=This is a test post to verify the API is working correctly." \
  -F "locationName=Colombo, Sri Lanka" \
  -F "latitude=6.9271" \
  -F "longitude=79.8612" \
  -F "tags[]=test" \
  -F "images=@/path/to/your/image.jpg"
```

### Get All Posts
```bash
curl -X GET "http://localhost:3007/api/community/posts?page=1&limit=10&sort=recent"
```

### Like a Post
```bash
curl -X POST http://localhost:3007/api/community/posts/POST_ID_HERE/like \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN_HERE"
```

### Add a Comment
```bash
curl -X POST http://localhost:3007/api/community/posts/POST_ID_HERE/comments \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"content": "Great post! Thanks for sharing."}'
```

---

## 📝 API Endpoints Summary

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/community/posts` | Get all posts (paginated) | No |
| GET | `/api/community/posts/:id` | Get single post | No |
| GET | `/api/community/posts/user/:userId` | Get posts by user | No |
| POST | `/api/community/posts` | Create new post | Yes |
| PUT | `/api/community/posts/:id` | Update post | Yes (author only) |
| DELETE | `/api/community/posts/:id` | Delete post | Yes (author only) |
| POST | `/api/community/posts/:id/like` | Like a post | Yes |
| DELETE | `/api/community/posts/:id/like` | Unlike a post | Yes |
| POST | `/api/community/posts/:id/comments` | Add comment | Yes |
| DELETE | `/api/community/posts/:id/comments/:commentId` | Delete comment | Yes |

---

## 🎯 Expected Behavior

### When Creating a Post:

1. **Mobile app sends FormData with**:
   - `title`: String
   - `content`: String  
   - `locationName`: String
   - `tags`: JSON array
   - `images`: Multiple files (up to 5)

2. **Backend processes**:
   - Validates all fields
   - Uploads images to Cloudinary (generates 3 sizes)
   - Saves post to MongoDB with image URLs
   - Cleans up temporary files
   - Returns created post

3. **Response includes**:
   - Full post object
   - All image URLs (thumbnail, medium, large)
   - Author information
   - Timestamp

### Image Storage Strategy:

- **Cloudinary**: Stores actual images (3 sizes per image)
- **MongoDB**: Stores only metadata (~200 bytes per image)
  - Public ID (for deletion)
  - URLs for all sizes
  - Original dimensions
  - Format and size

---

## 📱 Mobile App Changes

### Updated File: `app/community/create-post.tsx`

**Changes made**:
1. ✅ Added imports for API service and AsyncStorage
2. ✅ Added `useAuth` hook to get user data
3. ✅ Added `isPosting` state for loading indicator
4. ✅ Updated `handlePost` to actually send data to backend
5. ✅ Implemented FormData for multipart file upload
6. ✅ Added network detection for dynamic server URL
7. ✅ Added loading indicator on Share button
8. ✅ Added proper error handling

**Key code**:
```typescript
const handlePost = async () => {
  // Validation...
  
  const formData = new FormData();
  formData.append('title', postTitle.trim());
  formData.append('content', postContent.trim());
  formData.append('locationName', location.trim());
  formData.append('tags', JSON.stringify([selectedCategory]));
  
  // Add images
  selectedImages.forEach((image, index) => {
    formData.append('images', {
      uri: image.uri,
      name: `photo_${index}.jpg`,
      type: 'image/jpeg',
    });
  });
  
  // Get auth token
  const token = await AsyncStorage.getItem('accessToken');
  
  // Detect server URL
  const baseURL = await NetworkDetection.detectServer();
  const communityServiceURL = baseURL.replace(':3000', ':3007');
  
  // Send request
  const response = await fetch(`${communityServiceURL}/api/community/posts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });
  
  // Handle response...
};
```

---

## 🐛 Debug Checklist

If posts are not being created:

- [ ] Community service is running on port 3007
- [ ] MongoDB is running and connected
- [ ] Mobile app is logged in (has valid JWT token)
- [ ] Mobile device and server are on same WiFi network
- [ ] Network detection found the correct server IP
- [ ] Cloudinary credentials are correct in `.env`
- [ ] Images are not larger than 10MB
- [ ] Not more than 5 images selected

---

## 🚀 Next Steps

### To Display Posts in Mobile App:

1. **Fetch posts from API** in community tab
2. **Display posts in a FlatList**
3. **Show images using Cloudinary URLs**
4. **Implement like/unlike functionality**
5. **Implement comments section**
6. **Add pull-to-refresh**
7. **Add infinite scroll pagination**

### Sample code to fetch posts:
```typescript
const fetchPosts = async () => {
  try {
    const baseURL = await NetworkDetection.detectServer();
    const communityServiceURL = baseURL.replace(':3000', ':3007');
    
    const response = await fetch(
      `${communityServiceURL}/api/community/posts?page=1&limit=10&sort=recent`
    );
    
    const data = await response.json();
    
    if (data.success) {
      setPosts(data.data.posts);
    }
  } catch (error) {
    console.error('Error fetching posts:', error);
  }
};
```

---

## ✅ Success Checklist

- [x] Backend service created
- [x] MongoDB models defined
- [x] Cloudinary integration implemented
- [x] Image upload with multiple sizes
- [x] JWT authentication
- [x] CRUD operations for posts
- [x] Like/unlike functionality
- [x] Comments system
- [x] Mobile app integration
- [x] FormData file upload
- [x] Error handling
- [x] Loading states
- [ ] Display posts in mobile app (Next step)
- [ ] Implement likes UI (Next step)
- [ ] Implement comments UI (Next step)

---

## 📚 Documentation

Full API documentation is available in:
- `community-service/README.md`

For any issues, check:
1. Service logs: Check the terminal running community service
2. Mobile app logs: Check Expo console for errors
3. MongoDB: Check if data is being saved
4. Cloudinary: Check if images are being uploaded

---

## 🎊 You're All Set!

Your travel blog backend is ready to use! The system efficiently stores images on Cloudinary CDN while keeping MongoDB lean with only metadata. Users can now create posts with images, and the mobile app will seamlessly upload everything to the backend.

Happy coding! 🚀
