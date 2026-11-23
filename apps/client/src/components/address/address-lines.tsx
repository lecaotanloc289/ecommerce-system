import type { Address, ShippingAddressSnapshot } from '@repo/core';

/** Recipient, phone and address lines of an address (live `Address` or an order's snapshot). */
export function AddressLines({
  address,
}: {
  address: Pick<
    Address | ShippingAddressSnapshot,
    'recipientName' | 'phone' | 'line1' | 'line2' | 'ward' | 'district' | 'city'
  >;
}) {
  const area = [address.line1, address.line2, address.ward, address.district, address.city]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(', ');
  return (
    <div className="text-body-m text-text-body">
      <p className="font-medium text-text-primary">{address.recipientName}</p>
      <p>{address.phone}</p>
      <p>{area}</p>
    </div>
  );
}
