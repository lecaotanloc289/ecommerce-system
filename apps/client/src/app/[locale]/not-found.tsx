import { NotFoundContent } from '@/components/common/not-found-content';

/** 404 inside the locale layout — used when `notFound()` fires during a client navigation. */
export default function LocaleNotFound() {
  return <NotFoundContent />;
}
