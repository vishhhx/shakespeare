import { getRedisClient } from "../connections/redis";
import type { RedisClientType } from 'redis';
class redisServices{
    private client:RedisClientType;
    constructor(client:RedisClientType){
        this.client=client
    }

async storeOtp(phoneNumber: string, otp: string, ttlSeconds = 300): Promise<void> {
    const key = `otp:${phoneNumber}`;
    await this.client.set(key, otp, { EX: ttlSeconds });
}

async getOtp(phoneNumber: string): Promise<string | null> {
    const key = `otp:${phoneNumber}`;
    return await this.client.get(key);
}

async deleteOtp(phoneNumber: string): Promise<number> {
    const key = `otp:${phoneNumber}`;
    return await this.client.del(key);
}

async verifyOtp(phoneNumber: string, otp: string): Promise<boolean> {
    const savedOtp = await this.getOtp(phoneNumber);
    console.log(`Verifying OTP for ${phoneNumber}: provided=${otp}, saved=${savedOtp}`);
    if (!savedOtp || savedOtp !== otp) {
        return false;
    }

    await this.deleteOtp(phoneNumber);
    return true;
}

 async addLocation(
        key: string,
        member: string,
        longitude: number,
        latitude: number
    ): Promise<number> {
        return await this.client.geoAdd(key, {
            longitude,
            latitude,
            member
        });
    }
   async getNearbyLocations(
    key: string,
    longitude: number,
    latitude: number,
    radius: number,
    unit: 'm' | 'km' | 'mi' | 'ft' = 'km'
): Promise<{ member: string; distance: number }[]> {

    const results = await this.client.geoSearch(
        key,
        {
            longitude,
            latitude
        },
        {
            radius,
            unit
        },
    
    );

    const formattedResults: { member: string; distance: number }[] = [];
    for (const member of results as string[]) {
        formattedResults.push({ member, distance: 0 });
    }

    return formattedResults;
}

// Socket ID storage methods
async storeSocketId(role: string, userId: string, socketId: string): Promise<void> {
    const key = `socket:${role}:${userId}`;
    await this.client.set(key, socketId);
}

async getSocketId(role: string, userId: string): Promise<string | null> {
    const key = `socket:${role}:${userId}`;
    return await this.client.get(key);
}

async removeSocketId(role: string, userId: string): Promise<number> {
    const key = `socket:${role}:${userId}`;
    return await this.client.del(key);
}

async getAllSocketsByRole(role: string): Promise<Record<string, string>> {
    const pattern = `socket:${role}:*`;
    const keys = await this.client.keys(pattern);
    
    const result: Record<string, string> = {};
    for (const key of keys) {
        const socketId = await this.client.get(key);
        if (socketId) {
            result[key] = socketId;
        }
    }
    return result;
}


async getSocketIdsByUserIds(role: string, userIds: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const userId of userIds) {
        const socketId = await this.getSocketId(role, userId);
        if (socketId) {
            result[userId] = socketId;
        }
    }
    return result;
}

async getLocationsByMembers(
    key: string,
    members: string[]
): Promise<Record<string, { lng: number; lat: number }>> {
    const result: Record<string, { lng: number; lat: number }> = {};

    for (const member of members) {
        const pos = await this.client.geoPos(key, member);
        const first = Array.isArray(pos) ? pos[0] : null;

        if (first && first.longitude != null && first.latitude != null) {
            result[member] = {
                lng: Number(first.longitude),
                lat: Number(first.latitude),
            };
        }
    }

    return result;
}
}


const redisClient = await getRedisClient();
const redisService = new redisServices(redisClient);
export default redisService;