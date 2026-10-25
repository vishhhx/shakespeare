# Location Tracking System Documentation

## Overview

The location tracking system enables SafeSphere to track user and authority locations for better volunteer assignment and real-time tracking. Users can opt-in to continuous location tracking, while the system maintains location indices in Redis for efficient geo-spatial queries.

## Architecture

### Components

1. **Mobile App (Expo React Native)**
   - Location capture during profile creation
   - Continuous location tracking (user preference-based)
   - Location permission handling

2. **Backend (Express.js + Node.js)**
   - Location storage in MongoDB
   - Redis GEO index for efficient queries
   - Location service for monitoring and sync
   - Authority location indexing on login

3. **Database Layer**
   - MongoDB: Persistent storage of location data with timestamps
   - Redis: Real-time GEO-spatial indexing for quick queries

## Database Schema

### ProfilePublicUserModel
```typescript
location?: {
  lat: number;
  lng: number;
};
enableContinuousTracking?: boolean;  // User preference
lastLocationUpdate?: Date;            // Timestamp of last update
```

### AuthorityProfileModel
```typescript
location: {
  lat: number;
  lng: number;
};
```

## API Endpoints

### 1. Create/Update Profile with Location
**POST** `/api/public-user/profile`

**Payload:**
```json
{
  "name": "John Doe",
  "profileImage": "s3://...",
  "medicalRecord": { ... },
  "location": { "lat": 28.7041, "lng": 77.1025 },
  "enableContinuousTracking": true
}
```

**Response:**
```json
{
  "message": "Profile updated successfully",
  "profile": { ... }
}
```

### 2. Continuous Location Update
**POST** `/api/public-user/location`

**Payload:**
```json
{
  "location": { "lat": 28.7041, "lng": 77.1025 }
}
```

**Response:**
```json
{
  "message": "Location updated successfully",
  "location": { "lat": 28.7041, "lng": 77.1025 },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Frequency:** Every 30 seconds (configurable)
**Authentication:** RequirePublicAuth middleware

## Mobile Implementation

### 1. Location Capture During Profile Creation

The `SafeSphere/src/app/profile/create.tsx` component captures user location on mount:

```typescript
import * as Location from "expo-location";

const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
const [enableLocationTracking, setEnableLocationTracking] = useState(true);

const getLocation = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === "granted") {
      const loc = await Location.getCurrentPositionAsync({});
      setCurrentLocation({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
    }
  } catch (err) {
    console.error("Location error:", err);
  }
};

useEffect(() => {
  getLocation();
}, []);
```

**Key Features:**
- Automatic location capture with 5-second timeout
- Graceful degradation if permission denied
- Stores current coordinates in component state

### 2. Continuous Location Tracking Hook

The `useLocationTracking` hook (`SafeSphere/src/lib/useLocationTracking.ts`) manages continuous location updates:

```typescript
import { useLocationTracking } from "../../lib/useLocationTracking";

const { isTracking, lastUpdateTime, error } = useLocationTracking({
  enableTracking: trackingEnabled,
  intervalSeconds: 30,
  debug: true,
});
```

**Features:**
- Periodic location sends every 30 seconds
- Respects user preference toggle
- Graceful error handling
- Debug logging for monitoring
- Tracks last update timestamp

**Flow:**
1. User enables tracking in profile tab
2. Hook requests location permission
3. Sends location to backend immediately
4. Repeats every 30 seconds
5. Shows tracking status and last update time
6. Displays errors if location fails

### 3. Profile Tab UI

The `SafeSphere/src/app/(tabs)/profile.tsx` provides location tracking controls:

```typescript
import { useLocationTracking } from "../../lib/useLocationTracking";

const [trackingEnabled, setTrackingEnabled] = useState(false);

const { isTracking, lastUpdateTime, error } = useLocationTracking({
  enableTracking: trackingEnabled,
  intervalSeconds: 30,
  debug: true,
});
```

**UI Elements:**
- Location tracking toggle button (green = active)
- Real-time status display
- Last update timestamp
- Error messages

## Backend Implementation

### 1. Profile Controller - Location Storage

Updated `backend/src/models/ProfilePublicUser/profile.controller.ts`:

```typescript
export const upsertPublicUserProfile = async (req: Request, res: Response) => {
  // ... validatioQDRANT_API_KEYn ...
  
  const { location, enableContinuousTracking } = parsed.data;
  
  const updateData = {
    // ... other fields ...
    location,
    enableContinuousTracking,
    lastLocationUpdate: new Date(),
  };
  
  // Store in MongoDB
  const profile = await ProfilePublicUserModel.updateOne(
    { userId: req.authUser.userId },
    updateData,
    { upsert: true }
  );
  
  // Index in Redis for GEO queries
  if (location) {
    await redisService.addLocation(
      "public-users",
      String(profile._id),
      location.lng,
      location.lat
    );
  }
};
```

### 2. Continuous Update Controller

New controller `backend/src/models/AuthpublicUser/publicUser.controller.ts`:

```typescript
export const updateUserLocation = async (req: Request, res: Response) => {
  const { location } = req.body;
  
  // Validate location
  if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") {
    return res.status(400).json({ error: "Invalid location" });
  }
  
  // Update MongoDB
  await ProfilePublicUserModel.findOneAndUpdate(
    { userId: req.authUser.userId },
    {
      location,
      lastLocationUpdate: new Date(),
    }
  );
  
  // Update Redis GEO index
  await redisService.addLocation(
    "public-users",
    String(req.authUser.userId),
    location.lng,
    location.lat
  );
  
  return res.json({
    message: "Location updated",
    location,
    timestamp: new Date(),
  });
};
```

### 3. Authority Location Indexing on Login

Updated `backend/src/models/AuthadminUser/admiinUser.controller.ts`:

```typescript
export const adminUserLogin = async (req: Request, res: Response) => {
  // ... authentication logic ...
  
  // Index authority location on login
  if (user.role === "authority") {
    try {
      const authorityProfile = await AuthorityProfileModel.findOne({ 
        userId: user._id 
      });
      
      if (authorityProfile && authorityProfile.location) {
        // Add/update in Redis GEO index
        await redisService.addLocation(
          "authorities",
          String(authorityProfile._id),
          authorityProfile.location.lng,
          authorityProfile.location.lat
        );
      } else if (authorityProfile && !authorityProfile.location) {
        // Mark as needing location
        await redisService.markNeedsLocation(
          "authorities",
          String(authorityProfile._id)
        );
      }
    } catch (err) {
      console.error("Error indexing authority location:", err);
      // Continue login even if indexing fails
    }
  }
};
```

### 4. Location Service

New utility `backend/src/utils/locationService.ts` provides:

- **syncAuthorityLocations()**: Sync all authority locations to Redis on startup
- **getAuthoritiesNeedsLocation()**: Get list of authorities without location
- **notifyAuthorityNeedsLocation()**: Send notification to set location
- **isLocationFresh()**: Verify location is updated within threshold
- **cleanupStaleLocations()**: Clean up old location data
- **getLocationStatistics()**: Monitor location coverage

## Redis Data Structures

### GEO Indexes
```
Key: "public-users"
Type: Sorted Set (GEO)
Members: {userId: lat, lng}

Key: "authorities"
Type: Sorted Set (GEO)
Members: {authorityId: lat, lng}
```

### Sets for Tracking Missing Locations
```
Key: "authorities:needs-location"
Type: Set
Members: [authorityId1, authorityId2, ...]

Key: "public-users:needs-location"
Type: Set
Members: [userId1, userId2, ...]
```

## Volunteer Assignment Flow

1. **User creates profile** → Location captured and stored in DB + Redis
2. **User applies for volunteer** → System searches for authorities within 10km radius
3. **Geo-search query**:
   ```typescript
   const nearbyAuthorities = await redisService.getNearbyLocations(
     "authorities",
     userLocation.lng,
     userLocation.lat,
     10,  // 10km radius
     "km"
   );
   ```
4. **Auto-assignment** → Closest authority is assigned the application
5. **Authority indexing** → On login, authority location is verified and indexed

## Error Handling & Fallbacks

### Location Permission Denied
- App continues with last known location
- User can grant permission from device settings
- UI shows permission error with retry option

### Redis Indexing Failure
- Location still stored in MongoDB
- Graceful fallback to sequential search
- Error logged for monitoring
- No impact on critical workflows

### Missing Authority Location
- Tracked in Redis "needs-location" set
- Notification sent to authority
- Volunteer assignment falls back to all authorities
- Monitored via LocationService statistics

### Location Update Failure
- Previous location retained
- Error shown in UI
- Auto-retry on next interval
- Manual refresh available to user

## Security Considerations

1. **Permission Checks**
   - `requirePublicAuth` middleware on location endpoints
   - Only authenticated users can update own location

2. **Location Data Privacy**
   - Never exposed to other users
   - Only authorities can see user locations
   - Socket.io room-based access control

3. **Rate Limiting**
   - Max 1 location update per 5 seconds
   - Prevents abuse and data flooding

4. **Data Encryption**
   - Location data encrypted in transit (HTTPS)
   - Redis AOF persistence for durability

## Monitoring & Debugging

### Enable Debug Logging
```typescript
const { isTracking } = useLocationTracking({
  enableTracking: true,
  debug: true,  // Enables console.log
});
```

### Location Statistics API (Future)
```
GET /api/admin/location-stats
Response: {
  publicUsers: { total, withLocation, percentage },
  authorities: { total, withLocation, needsLocation, percentage }
}
```

### Troubleshooting

**Issue: Locations not updating**
- Check `enableContinuousTracking` in user profile
- Verify device location permissions
- Check network connectivity
- View browser console for errors

**Issue: Authority not appearing in search**
- Verify authority has location set
- Check Redis connection
- Run `LocationService.syncAuthorityLocations()`

**Issue: Stale location data**
- Clean up older than 7 days: `LocationService.cleanupStaleLocations(7)`
- Check `lastLocationUpdate` timestamp

## Future Enhancements

1. **Location History** - Store location trail for analytics
2. **Offline Support** - Queue updates while offline
3. **Location Accuracy** - Use GPS + WiFi triangulation
4. **Privacy Zones** - Allow users to exclude locations
5. **Real-time Maps** - WebSocket-based live tracking
6. **Geofencing** - Alerts when users enter/exit zones
7. **Location Analytics** - Heat maps of volunteer coverage

## Configuration

### Environment Variables
```env
LOCATION_UPDATE_INTERVAL_SECONDS=30
LOCATION_FRESHNESS_THRESHOLD_MINUTES=60
LOCATION_CLEANUP_DAYS=7
LOCATION_SEARCH_RADIUS_KM=10
```

### Constants
Located in `backend/src/config/env.ts`:
- Default update interval: 30 seconds
- Default freshness threshold: 60 minutes
- Cleanup threshold: 7 days
- Search radius: 10 km
