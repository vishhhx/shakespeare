import AsyncStorage from "@react-native-async-storage/async-storage";

const ACTIVE_CASE_STORAGE_KEY = "activeEmergencyCase";

/**
 * Clear all cached emergency data from local storage
 * Call this when:
 * - Emergency case is closed/deleted
 * - User logs out
 * - App initializes and needs a clean state
 */
export const clearEmergencyCache = async () => {
  try {
    console.log("[🗑️ Cache] Clearing emergency cache");
    await AsyncStorage.removeItem(ACTIVE_CASE_STORAGE_KEY);
    console.log("[🗑️ Cache] Emergency cache cleared successfully");
  } catch (error) {
    console.error("[🗑️ Cache] Failed to clear emergency cache:", error instanceof Error ? error.message : String(error));
  }
};

/**
 * Clear all app storage (for complete data cleanup)
 */
export const clearAllAppStorage = async () => {
  try {
    console.log("[🗑️ All Storage] Clearing all app storage");
    const keys = await AsyncStorage.getAllKeys();
    const appKeys = keys.filter(
      (key) => 
        key.includes("active") || 
        key.includes("emergency") || 
        key.includes("case") ||
        key.includes("auth")
    );
    
    if (appKeys.length > 0) {
      await AsyncStorage.multiRemove(appKeys);
      console.log("[🗑️ All Storage] Cleared storage keys:", appKeys);
    }
  } catch (error) {
    console.error("[🗑️ All Storage] Failed to clear app storage:", error instanceof Error ? error.message : String(error));
  }
};
