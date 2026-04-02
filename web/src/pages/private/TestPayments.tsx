import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { axiosInstance } from "@/utils";

declare global {
  interface Window {
    Razorpay?: any;
  }
}

type OrderResponse = {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status?: string;
};

function TestPayments() {
  const [amount, setAmount] = useState<string>("1");
  const [currency, setCurrency] = useState<string>("INR");

  const [pricingId, setPricingId] = useState<string>("");
  const [orderId, setOrderId] = useState<string>("");

  const [paymentId, setPaymentId] = useState<string>("");
  const [signature, setSignature] = useState<string>("");

  const [keyId, setKeyId] = useState<string>("");
  const [order, setOrder] = useState<OrderResponse | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<any>(null);

  const amountNumber = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) ? n : NaN;
  }, [amount]);

  useEffect(() => {
    const id = "razorpay-checkout-js";
    if (document.getElementById(id)) return;

    const script = document.createElement("script");
    script.id = id;
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      const message =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Request failed";
      setError(String(message));
      setResult(e?.response?.data ?? null);
    } finally {
      setBusy(null);
    }
  }, []);

  const createPricing = useCallback(() => {
    return run("createPricing", async () => {
      const { data } = await axiosInstance.post("payments/pricing", {
        amount: amountNumber,
        currency,
      });
      setResult(data);
      setPricingId(data?.data?._id || "");
    });
  }, [amountNumber, currency, run]);

  const createOrder = useCallback(() => {
    return run("createOrder", async () => {
      const payload: any = {
        amount: amountNumber,
        currency,
      };
      if (pricingId) payload.pricingId = pricingId;

      const { data } = await axiosInstance.post("payments/create-order", payload);
      setResult(data);

      const createdOrder = data?.data?.order as OrderResponse | undefined;
      const createdKeyId = data?.data?.keyId as string | undefined;

      if (createdOrder?.id) {
        setOrderId(createdOrder.id);
        setOrder(createdOrder);
      }
      if (createdKeyId) setKeyId(createdKeyId);
    });
  }, [amountNumber, currency, pricingId, run]);

  const verifyPayment = useCallback(
    (opts?: {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    }) => {
      return run("verifyPayment", async () => {
        const payload: any = {
          razorpay_order_id: opts?.razorpay_order_id ?? orderId,
          razorpay_payment_id: opts?.razorpay_payment_id ?? paymentId,
          razorpay_signature: opts?.razorpay_signature ?? signature,
        };
        if (pricingId) payload.pricingId = pricingId;

        const { data } = await axiosInstance.post("payments/verify", payload);
        setResult(data);
      });
    },
    [orderId, paymentId, signature, pricingId, run],
  );

  const fetchPaymentDetails = useCallback(() => {
    return run("fetchPayment", async () => {
      const id = paymentId.trim();
      if (!id) {
        setError("Payment ID is required");
        return;
      }

      const { data } = await axiosInstance.get(`payments/payment/${id}`);
      setResult(data);
    });
  }, [paymentId, run]);

  const openCheckout = useCallback(() => {
    if (!orderId || !keyId || !order?.amount || !order?.currency) {
      setError("Create an order first (needs orderId + keyId)");
      return;
    }

    if (String(order.currency).toUpperCase() !== "INR") {
      setError("For UPI testing, create the order with currency INR");
      return;
    }

    if (!window.Razorpay) {
      setError("Razorpay Checkout script not loaded yet");
      return;
    }

    setError(null);
    setCheckoutError(null);

    const options = {
      key: keyId,
      amount: order.amount,
      currency: order.currency,
      name: "Test Payment",
      description: "Razorpay test checkout",
      order_id: orderId,
      method: {
        upi: true,
        card: true,
        netbanking: true,
        wallet: true,
      },
      config: {
        display: {
          blocks: {
            upi: {
              name: "UPI",
              instruments: [{ method: "upi" }],
            },
          },
          sequence: ["block.upi"],
          preferences: {
            show_default_blocks: true,
          },
        },
      },
      retry: {
        enabled: false,
      },
      modal: {
        ondismiss: () => {
          setError("Checkout closed");
        },
      },
      handler: async (response: any) => {
        setPaymentId(response?.razorpay_payment_id || "");
        setSignature(response?.razorpay_signature || "");
        await verifyPayment({
          razorpay_order_id: response?.razorpay_order_id,
          razorpay_payment_id: response?.razorpay_payment_id,
          razorpay_signature: response?.razorpay_signature,
        });
      },
    };

    const rzp = new window.Razorpay(options);

    rzp.on("payment.failed", (resp: any) => {
      setCheckoutError(resp);
      setResult(resp);

      const desc =
        resp?.error?.description ||
        resp?.error?.reason ||
        resp?.error?.code ||
        "Payment failed";
      setError(String(desc));

      const failedPaymentId = resp?.error?.metadata?.payment_id;
      const failedOrderId = resp?.error?.metadata?.order_id;
      if (failedPaymentId) setPaymentId(String(failedPaymentId));
      if (failedOrderId) setOrderId(String(failedOrderId));
    });

    rzp.open();
  }, [keyId, order, orderId, verifyPayment]);

  return (
    <div className="p-6">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Test Payments</h1>
          <p className="text-sm text-muted-foreground">
            Requires you to be logged in (cookie auth). Backend base URL is
            `http://localhost:5000/api/v1`.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">Amount (₹)</div>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Currency</div>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                placeholder="INR"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">Pricing ID (optional)</div>
              <Input
                value={pricingId}
                onChange={(e) => setPricingId(e.target.value)}
                placeholder="Auto-filled after /pricing"
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Order ID</div>
              <Input
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="Auto-filled after /create-order"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={createPricing} disabled={!!busy}>
              {busy === "createPricing" ? "Creating..." : "Create Pricing"}
            </Button>
            <Button onClick={createOrder} disabled={!!busy} variant="secondary">
              {busy === "createOrder" ? "Creating..." : "Create Order"}
            </Button>
            <Button onClick={openCheckout} disabled={!!busy} variant="outline">
              Open Razorpay Checkout
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-1">
              <div className="text-sm font-medium">Payment ID</div>
              <Input
                value={paymentId}
                onChange={(e) => setPaymentId(e.target.value)}
                placeholder="razorpay_payment_id"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <div className="text-sm font-medium">Signature</div>
              <Input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="razorpay_signature"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => verifyPayment()} disabled={!!busy}>
              {busy === "verifyPayment" ? "Verifying..." : "Verify Payment"}
            </Button>
            <Button
              onClick={fetchPaymentDetails}
              disabled={!!busy}
              variant="secondary"
            >
              {busy === "fetchPayment" ? "Fetching..." : "Fetch Payment"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                setResult(null);
                setError(null);
                setCheckoutError(null);
              }}
            >
              Clear
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="rounded-lg border border-border p-4">
          <div className="mb-2 text-sm font-medium">Response</div>
          <pre className="max-h-[340px] overflow-auto rounded-md bg-muted p-3 text-xs">
            {result ? JSON.stringify(result, null, 2) : "No response yet"}
          </pre>
        </div>

        {checkoutError ? (
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 text-sm font-medium">Checkout Error</div>
            <pre className="max-h-[240px] overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(checkoutError, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default TestPayments;
