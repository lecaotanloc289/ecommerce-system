import type { CheckoutStepName } from './checkout';

/**
 * Where to send the customer after the API rejected "place order" (or a payment retry) with
 * `errorCode`: the step where they can fix it, or null to stay where they are (the message is
 * enough, or nothing on the page can fix it).
 */
export function stepForError(errorCode: string | null): CheckoutStepName | null {
  if (!errorCode) return null;
  switch (errorCode) {
    case 'checkout.error.empty-cart':
    case 'checkout.error.out-of-stock':
    case 'checkout.error.price-changed':
    case 'checkout.error.currency-mismatch':
    case 'product.error.not-available':
    case 'product.error.variant-not-found':
    case 'cart.error.quantity-exceeds-stock':
      return 'cart';
    case 'checkout.error.address-not-found':
      return 'info';
    case 'checkout.error.shipping-method-invalid':
    case 'checkout.error.shipping-method-missing':
    // The provider is picked together with shipping.
    case 'payment.error.provider-currency-unsupported':
      return 'shipping';
    default:
      // Coupon errors (`coupon.error.*`) are fixed on the review step itself.
      return errorCode.startsWith('coupon.error.') ? 'review' : null;
  }
}

/** The step's route (locale-less). */
export const STEP_PATH: Record<CheckoutStepName, string> = {
  cart: '/cart',
  info: '/checkout/info',
  shipping: '/checkout/shipping',
  review: '/checkout/review',
};
