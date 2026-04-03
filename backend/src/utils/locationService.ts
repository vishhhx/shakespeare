import redisService from "./redis";
import { AuthorityProfileModel } from "../models/ProfileAdminUser/authority.model";
import { ProfilePublicUserModel } from "../models/ProfilePublicUser/profile.model";
import snsService from "./sns";

/**
 * Location service for managing and monitoring user/authority location tracking
 */
export class LocationService {
  /**
   * Check and update authority locations on boot or periodically
   * This ensures all authorities are indexed in Redis GEO
   */
  static async syncAuthorityLocations() {
    try {
      console.log("[LocationService] Starting authority location sync...");

      // Get all authorities with profiles
      const authorities = await AuthorityProfileModel.find({
        location: { $exists: true, $ne: null },
      }).lean();

      let syncedCount = 0;
      let failedCount = 0;

      for (const authority of authorities) {
        try {
          await redisService.addLocation(
            "authorities",
            String(authority._id),
            authority.location.lng,
            authority.location.lat
          );
          await redisService.unmarkNeedsLocation("authorities", String(authority._id));
          syncedCount++;
        } catch (err) {
          console.error(`Failed to sync authority ${authority._id}:`, err);
          failedCount++;
        }
      }

      // Find authorities without locations
      const authoritiesWithoutLocation = await AuthorityProfileModel.find({
        $or: [
          { location: { $exists: false } },
          { location: null },
        ],
      }).lean();

      for (const authority of authoritiesWithoutLocation) {
        await redisService.markNeedsLocation("authorities", String(authority._id));
      }

      console.log(
        `[LocationService] Authority location sync complete: ${syncedCount} synced, ${failedCount} failed, ${authoritiesWithoutLocation.length} without location`
      );

      return { syncedCount, failedCount, needsLocationCount: authoritiesWithoutLocation.length };
    } catch (err) {
      console.error("[LocationService] Error syncing authority locations:", err);
      throw err;
    }
  }

  /**
   * Get list of authorities that need to set their location
   */
  static async getAuthoritiesNeedsLocation() {
    try {
      const authorityIds = await redisService.getNeedsLocationMembers("authorities");
      return authorityIds;
    } catch (err) {
      console.error("[LocationService] Error getting authorities needing location:", err);
      return [];
    }
  }

  /**
   * Send notification to authority to set their location
   */
  static async notifyAuthorityNeedsLocation(authorityProfileId: string) {
    try {
      const authority = await AuthorityProfileModel.findById(authorityProfileId).populate("userId");
      if (!authority) return;

      const adminUser = authority.userId as any;
      if (!adminUser?.email) return;

      // Send email notification
      await snsService.sendVerificationEmail(
        adminUser.email,
        `Please set your organization location in your profile to enable volunteer assignment. Visit the authority dashboard to update this information.`,
        "authority-location-reminder"
      );

      console.log(`[LocationService] Notification sent to ${adminUser.email} to set location`);
    } catch (err) {
      console.error("[LocationService] Error notifying authority:", err);
    }
  }

  /**
   * Verify user location freshness (last updated within threshold)
   */
  static async isLocationFresh(userId: string, thresholdMinutes = 60): Promise<boolean> {
    try {
      const user = await ProfilePublicUserModel.findOne({ userId }).lean();
      if (!user?.lastLocationUpdate) return false;

      const thresholdMs = thresholdMinutes * 60 * 1000;
      const timeSinceUpdate = Date.now() - new Date(user.lastLocationUpdate).getTime();

      return timeSinceUpdate <= thresholdMs;
    } catch (err) {
      console.error("[LocationService] Error checking location freshness:", err);
      return false;
    }
  }

  /**
   * Find all public users without locations
   */
  static async getUsersNeedsLocation() {
    try {
      const users = await ProfilePublicUserModel.find({
        $or: [
          { location: { $exists: false } },
          { location: null },
        ],
      })
        .select("_id userId name")
        .lean();

      return users;
    } catch (err) {
      console.error("[LocationService] Error getting users needing location:", err);
      return [];
    }
  }

  /**
   * Clean up stale location data from Redis (older than threshold)
   */
  static async cleanupStaleLocations(thresholdDays = 7) {
    try {
      console.log(`[LocationService] Cleaning up stale locations older than ${thresholdDays} days...`);

      const thresholdDate = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

      // Find users with stale location updates
      const staleUsers = await ProfilePublicUserModel.find({
        lastLocationUpdate: { $lt: thresholdDate },
      })
        .select("_id")
        .lean();

      console.log(`[LocationService] Found ${staleUsers.length} users with stale location data`);

      return staleUsers.length;
    } catch (err) {
      console.error("[LocationService] Error cleaning up stale locations:", err);
      return 0;
    }
  }

  /**
   * Get location statistics for monitoring
   */
  static async getLocationStatistics() {
    try {
      const publicWithLocation = await ProfilePublicUserModel.countDocuments({
        location: { $exists: true, $ne: null },
      });

      const publicTotal = await ProfilePublicUserModel.countDocuments();

      const authoritiesWithLocation = await AuthorityProfileModel.countDocuments({
        location: { $exists: true, $ne: null },
      });

      const authoritiesTotal = await AuthorityProfileModel.countDocuments();

      const authoritiesNeedsLocation = await redisService.getNeedsLocationMembers("authorities");

      return {
        publicUsers: {
          total: publicTotal,
          withLocation: publicWithLocation,
          percentage: publicTotal > 0 ? (publicWithLocation / publicTotal * 100).toFixed(2) : 0,
        },
        authorities: {
          total: authoritiesTotal,
          withLocation: authoritiesWithLocation,
          needsLocation: authoritiesNeedsLocation.length,
          percentage: authoritiesTotal > 0 ? (authoritiesWithLocation / authoritiesTotal * 100).toFixed(2) : 0,
        },
      };
    } catch (err) {
      console.error("[LocationService] Error getting location statistics:", err);
      return null;
    }
  }
}

export default LocationService;
