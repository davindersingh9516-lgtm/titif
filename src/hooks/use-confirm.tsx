import {
  createContext, useCallback, useContext, useRef, useState, type ReactNode,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, Info, Trash2, PauseCircle, LogOut, XCircle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
export type ConfirmVariant = "destructive" | "warning" | "info" | "pause" | "logout";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface DialogState {
  open: boolean;
  options: ConfirmOptions;
  resolve: (v: boolean) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────
const ConfirmCtx = createContext<ConfirmFn | null>(null);

const DEFAULT_OPTIONS: ConfirmOptions = { title: "Are you sure?", variant: "info" };

// ── Provider ──────────────────────────────────────────────────────────────────
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>({
    open: false,
    options: DEFAULT_OPTIONS,
    resolve: () => {},
  });

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, options, resolve });
    });
  }, []);

  const close = (value: boolean) => {
    state.resolve(value);
    setState((s) => ({ ...s, open: false }));
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <ConfirmDialog state={state} onClose={close} />
    </ConfirmCtx.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmCtx);
  if (!fn) throw new Error("useConfirm must be used inside ConfirmProvider");
  return fn;
}

// ── Variant config ────────────────────────────────────────────────────────────
const VARIANT_CONFIG: Record<
  ConfirmVariant,
  { icon: ReactNode; iconBg: string; confirmClass: string; confirmLabel: string }
> = {
  destructive: {
    icon: <Trash2 className="h-6 w-6 text-destructive" />,
    iconBg: "bg-destructive/10",
    confirmClass:
      "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/50",
    confirmLabel: "Delete",
  },
  warning: {
    icon: <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />,
    iconBg: "bg-amber-500/10",
    confirmClass:
      "bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500/50",
    confirmLabel: "Confirm",
  },
  info: {
    icon: <Info className="h-6 w-6 text-primary" />,
    iconBg: "bg-primary/10",
    confirmClass:
      "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/50",
    confirmLabel: "Confirm",
  },
  pause: {
    icon: <PauseCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />,
    iconBg: "bg-amber-500/10",
    confirmClass:
      "bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500/50",
    confirmLabel: "Pause",
  },
  logout: {
    icon: <LogOut className="h-6 w-6 text-destructive" />,
    iconBg: "bg-destructive/10",
    confirmClass:
      "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/50",
    confirmLabel: "Sign out",
  },
};

// ── Dialog component ──────────────────────────────────────────────────────────
function ConfirmDialog({
  state,
  onClose,
}: {
  state: DialogState;
  onClose: (value: boolean) => void;
}) {
  const { options } = state;
  const variant = options.variant ?? "info";
  const cfg = VARIANT_CONFIG[variant];

  return (
    <DialogPrimitive.Root
      open={state.open}
      onOpenChange={(open) => { if (!open) onClose(false); }}
    >
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        {/* Panel */}
        <DialogPrimitive.Content
          onInteractOutside={(e) => e.preventDefault()}
          className={[
            "fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border border-border bg-background p-6 shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
            "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
          ].join(" ")}
        >
          {/* Icon + title + body */}
          <div className="flex flex-col items-center text-center gap-3">
            <div className={`flex h-14 w-14 items-center justify-center rounded-full ${cfg.iconBg}`}>
              {cfg.icon}
            </div>
            <DialogPrimitive.Title className="text-lg font-bold text-foreground leading-snug">
              {options.title}
            </DialogPrimitive.Title>
            {options.body && (
              <DialogPrimitive.Description className="text-sm text-muted-foreground leading-relaxed">
                {options.body}
              </DialogPrimitive.Description>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => onClose(false)}
              className={[
                "flex-1 rounded-xl border border-border bg-background px-4 py-2.5",
                "text-sm font-semibold text-foreground",
                "transition hover:bg-muted active:scale-95",
              ].join(" ")}
            >
              {options.cancelLabel ?? "Cancel"}
            </button>
            <button
              onClick={() => onClose(true)}
              className={[
                "flex-1 rounded-xl px-4 py-2.5",
                "text-sm font-semibold",
                "transition active:scale-95 focus-visible:outline-none focus-visible:ring-2",
                cfg.confirmClass,
              ].join(" ")}
            >
              {options.confirmLabel ?? cfg.confirmLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
