import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from './config';
console.log('API Base URL:', config.apiBaseUrl);
export const api = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 15000,
});

api.interceptors.request.use(async (requestConfig) => {
  const token = await AsyncStorage.getItem('authToken');
  console.log('Retrieved token from AsyncStorage:', token);
  if (token) {
    requestConfig.headers = requestConfig.headers ?? {};
    (requestConfig.headers as any).Authorization = `Bearer ${token}`;
  }
  return requestConfig;
});
