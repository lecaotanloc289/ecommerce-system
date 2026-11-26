'use client';

import { ShoppingBag } from 'lucide-react';
import { Button, Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@repo/ui';
import { PinnedProductCard } from './pinned-product-card';
import { useT } from '../../i18n/use-locale';
import { getLiveProduct, type MockLiveProduct } from '../../mocks/live';

export function LiveProductsDrawer({
  productIds,
  pinnedProductId,
}: {
  productIds: string[];
  pinnedProductId: string | null;
}) {
  const t = useT();
  const items = productIds
    .map((id) => getLiveProduct(id))
    .filter((p): p is MockLiveProduct => p !== undefined);
  const title = t('live.productsInLive', { count: items.length });

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button
          variant="outline"
          size="md"
          iconLeft={<ShoppingBag className="size-4" aria-hidden />}
        >
          {title}
        </Button>
      </DrawerTrigger>
      <DrawerContent side="bottom" className="max-h-[80vh] overflow-y-auto p-4">
        <DrawerHeader>
          <DrawerTitle className="font-heading text-h5">{title}</DrawerTitle>
        </DrawerHeader>
        <ul className="mt-2 flex flex-col gap-3">
          {items.map((product) => (
            <li key={product.id}>
              <PinnedProductCard product={product} highlighted={product.id === pinnedProductId} />
            </li>
          ))}
        </ul>
      </DrawerContent>
    </Drawer>
  );
}
