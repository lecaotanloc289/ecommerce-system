// PaymentProvider interface + VNPay / Stripe adapters.
// Pure logic, no DB access; apps/api injects implementations into services.
// Adding a new provider = new adapter + register it; no business-logic changes.
export {};
