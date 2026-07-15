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
