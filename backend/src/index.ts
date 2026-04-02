import connectToMongoDB from "./connections/mongodb"
import { httpServer } from "./app"
import { env } from "./config/env"
import { connectToRedis } from "./connections/redis"


 async function Init() {
    await connectToMongoDB()
    await connectToRedis()
    httpServer.listen(env.PORT, () => {
        console.log(`Server is running on port ${env.PORT}`)
    })
}


await Init()