import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { fmtINR } from "@/lib/meals";
import { toast } from "sonner";
import { CheckCircle2, Copy, Loader2, ShieldCheck } from "lucide-react";

const PRESETS = [200, 500, 1000, 2000];

type PaymentRequest = {
  payment_id: string;
  amount: number;
  qr_payload: string;
  vpa: string;
  merchant_name: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** A pending payment from a previous session — resume QR + UTR step. */
  resume?: { id: string; amount: number; qr_payload: string | null } | null;
}

export function AddMoneySheet({ open, onClose, resume }: Props) {
  const [step, setStep] = useState<"amount" | "qr" | "submitted">("amount");
  const [amount, setAmount] = useState<string>("500");
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [utr, setUtr] = useState("");

  // Hydrate from a resumed pending payment.
  useEffect(() => {
    if (open && resume && resume.qr_payload) {
      setRequest({
        payment_id: resume.id,
        amount: Number(resume.amount),
        qr_payload: resume.qr_payload,
        vpa: "",
        merchant_name: "",
      });
      setStep("qr");
    } else if (open && !resume) {
      setStep("amount");
      setRequest(null);
      setUtr("");
      setAmount("500");
    }
  }, [open, resume]);

  const createRequest = async () => {
    const n = Number(amount);
    if (!n || n < 10) return toast.error("Minimum ₹10");
    if (n > 50000) return toast.error("Maximum ₹50,000");
    setBusy(true);
    const { data, error } = await supabase.rpc("create_payment_request", { p_amount: n });
    setBusy(false);
    if (error) {
      if (error.message.includes("pending_payment_exists"))
        return toast.error("You already have a pending payment. Complete or wait for that one first.");
      return toast.error(error.message);
    }
    setRequest(data as unknown as PaymentRequest);
    setStep("qr");
  };

  const submitUtr = async () => {
    if (!request) return;
    if (utr.trim().length < 8) return toast.error("Enter the full UTR / UPI reference (at least 8 digits)");
    setBusy(true);
    const { error } = await supabase.rpc("submit_payment_utr", {
      p_payment_id: request.payment_id,
      p_utr: utr.trim(),
    });
    setBusy(false);
    if (error) {
      if (error.message.includes("utr_already_used"))
        return toast.error("This UTR has already been used for another payment. Please check your UPI app.");
      return toast.error(error.message);
    }
    setStep("submitted");
  };

  const qrUrl = request
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=${encodeURIComponent(request.qr_payload)}`
    : "";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl p-0">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>
            {step === "amount" && "Add money"}
            {step === "qr" && "Scan & pay"}
            {step === "submitted" && "Verifying payment"}
          </SheetTitle>
        </SheetHeader>

        {step === "amount" && (
          <div className="space-y-5 px-5 py-5">
            <div className="space-y-2">
              <Label>Amount</Label>
              <div className="flex items-center gap-2 rounded-2xl border-2 border-input bg-card p-3 focus-within:border-primary">
                <span className="text-lg font-semibold text-muted-foreground">₹</span>
                <Input
                  type="tel"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                  placeholder="500"
                  className="border-0 px-1 text-2xl font-bold shadow-none focus-visible:ring-0"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(String(p))}
                  className={`rounded-xl border px-2 py-2 text-sm font-semibold transition ${
                    Number(amount) === p
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  +₹{p}
                </button>
              ))}
            </div>
            <Button onClick={createRequest} disabled={busy} size="lg" className="h-12 w-full bg-gradient-primary text-base">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Continue · ${fmtINR(Number(amount) || 0)}`}
            </Button>
            <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              <span>Secure UPI payment. Money is added only after admin verification — usually within minutes.</span>
            </div>
          </div>
        )}

        {step === "qr" && request && (
          <div className="space-y-4 px-5 py-5">
            {/* QR card */}
            <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card p-5">
              <div className="rounded-2xl bg-white p-2 shadow-sm">
                <img src={qrUrl} alt="UPI QR" width={200} height={200} className="rounded" />
              </div>

              {/* Merchant info — clearly labelled so user isn't confused in GPay */}
              <div className="w-full rounded-xl bg-muted/60 px-4 py-3 text-center">
                {request.merchant_name && (
                  <div className="text-sm font-bold">{request.merchant_name}</div>
                )}
                <div className="mt-0.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-mono">{request.vpa}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(request.vpa);
                      toast.success("UPI ID copied");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-2 text-xl font-extrabold tabular-nums">{fmtINR(request.amount)}</div>
              </div>

              <a
                href={request.qr_payload}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary"
              >
                Open in UPI app (GPay / PhonePe / Paytm)
              </a>
            </div>

            {/* Step instructions */}
            <ol className="space-y-1.5 rounded-xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
              <li><span className="font-semibold text-foreground">1.</span> Scan QR above or tap "Open in UPI app"</li>
              <li><span className="font-semibold text-foreground">2.</span> Pay {fmtINR(request.amount)} — you'll see <span className="font-semibold text-foreground">{request.merchant_name || request.vpa}</span> as the recipient</li>
              <li><span className="font-semibold text-foreground">3.</span> Copy the <span className="font-semibold text-foreground">UTR / transaction ID</span> from your UPI app and paste below</li>
            </ol>

            <div className="space-y-2">
              <Label>UTR / UPI Reference Number</Label>
              <Input
                value={utr}
                onChange={(e) => setUtr(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                placeholder="e.g. 412345678901"
                className="h-11 font-mono tracking-wider"
                maxLength={30}
              />
              <p className="text-xs text-muted-foreground">
                12-digit number shown in GPay / PhonePe after payment succeeds. Usually starts with digits only.
              </p>
            </div>

            <Button onClick={submitUtr} disabled={busy} size="lg" className="h-12 w-full bg-gradient-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit for verification"}
            </Button>
          </div>
        )}

        {step === "submitted" && (
          <div className="flex flex-col items-center gap-4 px-5 py-10 text-center">
            <div className="rounded-full bg-success/10 p-4">
              <CheckCircle2 className="h-10 w-10 text-success" />
            </div>
            <div>
              <div className="text-lg font-bold">Payment submitted</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Your wallet will be credited as soon as our team verifies the payment. You'll get a notification.
              </p>
            </div>
            <Button onClick={onClose} variant="outline" className="w-full">
              Done
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
