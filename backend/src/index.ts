import connectToMongoDB from "./connections/mongodb"
import { httpServer } from "./app"
import { env } from "./config/env"
import { connectToRedis } from "./connections/redis"
import LocationService from "./utils/locationService"


 async function Init() {
    await connectToMongoDB()
    await connectToRedis()
    
    // Sync authority locations on startup
    try {
        const syncResult = await LocationService.syncAuthorityLocations();
        console.log("[Startup] Location sync result:", syncResult);
    } catch (err) {
        console.error("[Startup] Error syncing locations on startup:", err);
    }
    
    httpServer.listen(env.PORT, () => {
        console.log(`Server is running on port ${env.PORT}`)
    })
}


await Init()