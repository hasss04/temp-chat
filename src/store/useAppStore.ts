import { create } from 'zustand';
import type { PlainMessage } from '../types';

type State = {
  roomId: string;
  nickname: string;
  secret: string;
  connected: boolean;
  messages: PlainMessage[];
  setStatePartial: (value: Partial<State>) => void;
  addMessage: (message: PlainMessage) => void;
  reset: () => void;
};

export const useAppStore = create<State>((set) => ({
  roomId: '',
  nickname: '',
  secret: '',
  connected: false,
  messages: [],
  setStatePartial: (value) => set((state) => ({ ...state, ...value })),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  reset: () => set({ roomId: '', nickname: '', secret: '', connected: false, messages: [] })
}));
