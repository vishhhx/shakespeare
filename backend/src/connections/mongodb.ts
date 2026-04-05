import mongoose from 'mongoose'
import { env } from '../config/env'
import EmergencyModel from '../models/emergency/emergency.model'
const connectToMongoDB=async()=>{
    try {
        await mongoose.connect(env.MONGO_URI)
        await EmergencyModel.createIndexes()
        console.log('Emergency indexes ensured')
        console.log('Connected to MongoDB')
    } catch (error) {
        console.error('Error connecting to MongoDB:', error)
        throw error
        
    }
}

export default connectToMongoDB