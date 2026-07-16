import { create } from 'zustand';
import type {
  PlainMessage,
  ThemeMode,
  ResolvedTheme,
  VoiceMessageState,
  GroupRoomInfo,
  RoomParticipant,
} from '../types';

export type ConnectionStatus =
  | 'idle'
  | 'joining'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type ToastTone = 'success' | 'error' | 'info';
export type ToastItem = {
  id: string;
  title: string;
  message: string;
  tone: ToastTone;
};

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

type State = {
  roomId: string;
  peerId: string;
  nickname: string;
  secret: string;
  connected: boolean;
  connectionStatus: ConnectionStatus;
  activeTab: 'chat' | 'call';
  roomFull: boolean;
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  isOnline: boolean;
  draft: string;
  messages: PlainMessage[];
  unreadCount: number;
  toasts: ToastItem[];
  voiceMessage: VoiceMessageState;
  groupInfo: GroupRoomInfo | null;
  participants: RoomParticipant[];
  setStatePartial: (value: Partial<State>) => void;
  addMessage: (message: PlainMessage) => void;
  markMessageDelivered: (messageId: string, at: number) => void;
  markMessageSeen: (messageId: string, at: number) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setActiveTab: (tab: 'chat' | 'call') => void;
  setThemeMode: (mode: ThemeMode) => void;
  setDraft: (draft: string) => void;
  setOnline: (online: boolean) => void;
  incrementUnread: () => void;
  resetUnread: () => void;
  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
  setVoiceMessage: (partial: Partial<VoiceMessageState>) => void;
  setGroupInfo: (info: GroupRoomInfo | null) => void;
  setParticipants: (participants: RoomParticipant[]) => void;
  reset: () => void;
};

function applyThemeToDocument(theme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

const initialThemeMode: ThemeMode = 'system';
const initialResolved = resolveTheme(initialThemeMode);
applyThemeToDocument(initialResolved);

const initialVoiceMessage: VoiceMessageState = {
  recording: false,
  audioUrl: null,
  duration: 0,
  waveform: [],
};

export const useAppStore = create<State>((set) => ({
  roomId: '',
  peerId: '',
  nickname: '',
  secret: '',
  connected: false,
  connectionStatus: 'idle',
  activeTab: 'chat',
  roomFull: false,
  themeMode: initialThemeMode,
  resolvedTheme: initialResolved,
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  draft: '',
  messages: [],
  unreadCount: 0,
  toasts: [],
  voiceMessage: initialVoiceMessage,
  groupInfo: null,
  participants: [],
  setStatePartial: (value) => set((state) => ({ ...state, ...value })),
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  markMessageDelivered: (messageId, at) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              deliveredAt: msg.deliveredAt ?? at,
            }
          : msg,
      ),
    })),
  markMessageSeen: (messageId, at) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              deliveredAt: msg.deliveredAt ?? at,
              seenAt: msg.seenAt ?? at,
            }
          : msg,
      ),
    })),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setThemeMode: (mode) => {
    const resolved = resolveTheme(mode);
    applyThemeToDocument(resolved);
    set({ themeMode: mode, resolvedTheme: resolved });
  },
  setDraft: (draft) => set({ draft }),
  setOnline: (online) => set({ isOnline: online }),
  incrementUnread: () =>
    set((state) => ({
      unreadCount: state.unreadCount + 1,
    })),
  resetUnread: () => set({ unreadCount: 0 }),
  pushToast: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id: crypto.randomUUID(),
          ...toast,
        },
      ],
    })),
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
  clearToasts: () => set({ toasts: [] }),
  setVoiceMessage: (partial) =>
    set((state) => ({
      voiceMessage: { ...state.voiceMessage, ...partial },
    })),
  setGroupInfo: (info) => set({ groupInfo: info }),
  setParticipants: (participants) => set({ participants }),
  reset: () =>
    set((state) => ({
      roomId: '',
      peerId: '',
      nickname: '',
      secret: '',
      connected: false,
      connectionStatus: 'idle',
      activeTab: 'chat',
      roomFull: false,
      messages: [],
      unreadCount: 0,
      toasts: [],
      draft: '',
      voiceMessage: initialVoiceMessage,
      groupInfo: null,
      participants: [],
      themeMode: state.themeMode,
      resolvedTheme: state.resolvedTheme,
      isOnline: state.isOnline,
    })),
}));

export function watchSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    const { themeMode } = useAppStore.getState();
    if (themeMode !== 'system') return;
    const resolved = resolveTheme('system');
    applyThemeToDocument(resolved);
    useAppStore.setState({ resolvedTheme: resolved });
  };
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}

export function watchOnlineStatus() {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => useAppStore.setState({ isOnline: true });
  const onOffline = () => useAppStore.setState({ isOnline: false });
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}