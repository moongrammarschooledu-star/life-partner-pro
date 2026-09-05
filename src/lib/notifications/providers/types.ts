export interface ProviderSendResult {
  providerMessageId?: string;
}

export interface NotificationProvider {
  // Never throws — callers (dispatch.ts) treat a thrown error as a failed
  // send and record it on the CommunicationLog row; providers themselves may
  // throw for genuine transport errors, but the console fallback never does.
  send(to: string, body: string, subject?: string): Promise<ProviderSendResult>;
}
