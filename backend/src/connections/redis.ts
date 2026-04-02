import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export const connectToRedis = async (): Promise<RedisClientType> => {
    if (client && client.isOpen) {
        return client;
    }

    client = createClient({
        socket: {
            host: 'localhost',
            port: 6379,
        },
    });

    client.on('error', (err: Error) => {
        console.error('Redis Error:', err);
    });

    client.on('connect', () => {
        console.log('Connected to Redis');
    });

    await client.connect();

    return client;
};

export const getRedisClient = async (): Promise<RedisClientType> => {
    if (!client) {
        client = await connectToRedis();
    } else if (!client.isOpen) {
        await client.connect();
    }

    return client;
};