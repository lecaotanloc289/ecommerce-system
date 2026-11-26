'use client';

import { useT } from '../../i18n/use-locale';
import type { MessageKey } from '../../i18n/use-locale';

/** Marketing panel beside the auth form (Parts/Sign In & Register/350px/Info). */
export function PromoAside({
  title = 'auth.promoTitle',
  body = 'auth.promoBody',
  seed = 'elma-auth',
}: {
  title?: MessageKey;
  body?: MessageKey;
  seed?: string;
}) {
  const t = useT();
  return (
    <div className="relative hidden overflow-hidden rounded-xl bg-slate-12 p-8 text-text-on-primary lg:flex lg:flex-col lg:justify-end">
      <img
        src={`https://picsum.photos/seed/${seed}/700/900`}
        alt=""
        className="absolute inset-0 size-full object-cover opacity-40"
      />
      <div className="relative flex flex-col gap-3">
        <h2 className="font-heading text-h3 font-bold leading-tight">{t(title)}</h2>
        <p className="max-w-sm text-body-m opacity-80">{t(body)}</p>
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={
                i === 1 ? 'h-2 w-6 rounded-full bg-base-0' : 'size-2 rounded-full bg-base-0/40'
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
