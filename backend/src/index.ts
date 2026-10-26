import connectToMongoDB from "./connections/mongodb"
import { httpServer } from "./app"
import { env } from "./config/env"
import { connectToRedis } from "./connections/redis"
import { connectToQdrant } from "./connections/qdrant"
import LocationService from "./utils/locationService"
import { startSqsWorker, startVoiceSqsWorker } from "./worker/sqsWorker"


 async function Init() {
    await connectToMongoDB()
    await connectToRedis()
     await connectToQdrant()

    // Test servers set DISABLE_SQS_WORKERS so they never consume (and eventually drop) real queue messages.
    const workersDisabled = process.env.DISABLE_SQS_WORKERS === "true"

    if (workersDisabled) {
        console.warn("[Startup] DISABLE_SQS_WORKERS=true: SQS workers not started.")
    } else if (env.SQS_QUEUE_URL) {
        startSqsWorker().catch((error) => {
            console.error("[Startup] Failed to start SQS worker:", error)
        })
    } else {
        console.warn("[Startup] SQS_QUEUE_URL is not set. SQS worker not started.")
    }

    if (workersDisabled) {
        // already logged above
    } else if (env.SQS_VOICE_QUEUE_URL) {
        startVoiceSqsWorker().catch((error) => {
            console.error("[Startup] Failed to start voice SQS worker:", error)
        })
    } else {
        console.warn("[Startup] SQS_VOICE_QUEUE_URL is not set. Voice SQS worker not started.")
    }
    
    
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