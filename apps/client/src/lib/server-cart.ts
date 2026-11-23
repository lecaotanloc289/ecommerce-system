import type { Cart } from '@repo/core';
import { maxQtyFor, type CartLineView } from './cart';

/**
 * Flatten the server cart (lines grouped by vendor) into the same `CartLineView`s the guest
 * cart renders — group fields (`vendorName`, `vendorSlug`) are copied onto each line.
 */
export function cartToViews(cart: Cart): CartLineView[] {
  return cart.groups.flatMap((group) =>
    group.lines.map(
      (line): CartLineView => ({
        variantId: line.variantId,
        productId: line.productId,
        vendorId: line.vendorId,
        productName: line.productName,
        productSlug: line.productSlug,
        attributes: line.attributes,
        imageUrl: line.imageUrl,
        unitPrice: line.unitPrice,
        stockAvailable: line.stockAvailable,
        vendorName: group.vendorName,
        vendorSlug: group.vendorSlug,
        quantity: line.quantity,
        unavailable: line.unavailable,
        maxQty: maxQtyFor(line.stockAvailable),
      }),
    ),
  );
}
