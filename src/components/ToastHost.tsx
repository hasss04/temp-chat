import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

const TONE_ICON = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismissToast(toast.id), 3500),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [toasts, dismissToast]);

  if (!toasts.length) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => {
        const Icon = TONE_ICON[toast.tone];
        return (
          <div key={toast.id} className={`toast ${toast.tone}`} role="status">
            <div className="toast-row">
              <div className="toast-icon">
                <Icon size={18} />
              </div>
              <div>
                <p className="toast-title">{toast.title}</p>
                <p className="toast-message">{toast.message}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
