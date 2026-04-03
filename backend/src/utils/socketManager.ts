// Global Socket.io instance storage
let globalIo: any = null;

export const setGlobalIO = (io: any) => {
  globalIo = io;
};

export const getGlobalIO = () => {
  if (!globalIo) {
    console.warn("Socket.io instance not initialized yet");
  }
  return globalIo;
};
