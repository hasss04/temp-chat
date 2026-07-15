export type PlainMessage = {
  id: string;
  sender: 'me' | 'peer' | 'system';
  text: string;
  createdAt: number;
};

export type EncryptedBlob = {
  iv: string;
  cipherText: string;
};

// Wire protocol sent over the RTCDataChannel
export type WireMessage =
  | { kind: 'chat'; id: string; text: string; senderName: string; createdAt: number }
  | { kind: 'typing'; isTyping: boolean };