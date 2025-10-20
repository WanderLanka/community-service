const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// Test creating a map point
async function testCreateMapPoint() {
  try {
    const form = new FormData();
    
    // Add form fields
    form.append('title', 'Galle Fort Sunset Point');
    form.append('description', 'Amazing sunset viewpoint at Galle Fort with panoramic ocean views. Perfect for photography and romantic evenings!');
    form.append('latitude', '6.0259');
    form.append('longitude', '80.2168');
    form.append('category', 'viewpoint');
    form.append('tags', 'sunset,photography,ocean view,romantic');
    form.append('address', 'Galle Fort, Galle, Sri Lanka');
    form.append('placeName', 'Galle Fort Ramparts');
    form.append('rating', '5');

    // Make the request
    console.log('\n🧪 Testing Map Point Creation...\n');
    console.log('📋 Request Data:');
    console.log('   Title:', 'Galle Fort Sunset Point');
    console.log('   Location:', '6.0259, 80.2168');
    console.log('   Category:', 'viewpoint');
    console.log('   Tags:', 'sunset,photography,ocean view,romantic\n');

    const response = await axios.post(
      'http://192.168.8.159:3000/api/community/map-points',
      form,
      {
        headers: {
          ...form.getHeaders(),
          // Mock JWT token - in production, use real token from login
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NzYyZGQxOTI1MzE2YzE5Zjc0ZjNhNDciLCJ1c2VybmFtZSI6InRlc3R1c2VyIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwicm9sZSI6InRyYXZlbGVyIiwiaWF0IjoxNzAwMDAwMDAwfQ.mock_signature'
        }
      }
    );

    console.log('✅ Success! Map Point Created:\n');
    console.log('   ID:', response.data.data._id);
    console.log('   Title:', response.data.data.title);
    console.log('   Location:', response.data.data.location.coordinates);
    console.log('   Category:', response.data.data.category);
    console.log('   Tags:', response.data.data.tags);
    console.log('\n📊 Full Response:');
    console.log(JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('\n❌ Error creating map point:');
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Message:', error.response.data.message || error.response.data);
      if (error.response.data.errors) {
        console.error('   Validation Errors:', error.response.data.errors);
      }
    } else if (error.request) {
      console.error('   No response received from server');
      console.error('   Request:', error.request);
    } else {
      console.error('   Error:', error.message);
    }
  }
}

// Test retrieving map points
async function testGetMapPoints() {
  try {
    console.log('\n\n🧪 Testing Map Point Retrieval...\n');

    const response = await axios.get(
      'http://192.168.8.159:3000/api/community/map-points',
      {
        params: {
          page: 1,
          limit: 10
        }
      }
    );

    console.log('✅ Success! Retrieved Map Points:\n');
    console.log('   Total:', response.data.pagination.total);
    console.log('   Page:', response.data.pagination.page);
    console.log('   Limit:', response.data.pagination.limit);
    console.log('\n📍 Map Points:');
    response.data.data.forEach((point, index) => {
      console.log(`\n   ${index + 1}. ${point.title}`);
      console.log(`      Category: ${point.category}`);
      console.log(`      Location: ${point.location.coordinates[1]}, ${point.location.coordinates[0]}`);
      console.log(`      Likes: ${point.likesCount}, Saves: ${point.savesCount}`);
    });

  } catch (error) {
    console.error('\n❌ Error retrieving map points:');
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Message:', error.response.data.message || error.response.data);
    } else {
      console.error('   Error:', error.message);
    }
  }
}

// Test nearby search
async function testNearbySearch() {
  try {
    console.log('\n\n🧪 Testing Nearby Map Points Search...\n');
    console.log('📍 Searching near Galle Fort (6.0259, 80.2168)...\n');

    const response = await axios.get(
      'http://192.168.8.159:3000/api/community/map-points',
      {
        params: {
          latitude: 6.0259,
          longitude: 80.2168,
          maxDistance: 10000, // 10km radius
          page: 1,
          limit: 10
        }
      }
    );

    console.log('✅ Success! Found Nearby Map Points:\n');
    console.log('   Total:', response.data.pagination.total);
    response.data.data.forEach((point, index) => {
      console.log(`\n   ${index + 1}. ${point.title}`);
      console.log(`      Distance: ~${Math.round(point.distance)}m`);
      console.log(`      Category: ${point.category}`);
    });

  } catch (error) {
    console.error('\n❌ Error searching nearby map points:');
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Message:', error.response.data.message || error.response.data);
    } else {
      console.error('   Error:', error.message);
    }
  }
}

// Run tests
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 MAP POINT API TESTS');
  console.log('='.repeat(60));
  
  // Test 1: Create a map point
  await testCreateMapPoint();
  
  // Wait a bit before next test
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Get all map points
  await testGetMapPoints();
  
  // Wait a bit before next test
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 3: Nearby search
  await testNearbySearch();
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ ALL TESTS COMPLETED');
  console.log('='.repeat(60) + '\n');
}

runTests();
