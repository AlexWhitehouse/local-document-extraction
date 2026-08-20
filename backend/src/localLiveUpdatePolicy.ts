export const LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY = {
  backpressureLimit: 64 * 1024,
  closeOnBackpressureLimit: true,
  idleTimeout: 300,
  maxPayloadLength: 64,
  sendPings: true,
} as const;
