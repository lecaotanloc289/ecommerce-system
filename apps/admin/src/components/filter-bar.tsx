import { useId, useState, type FormEvent, type SelectHTMLAttributes } from 'react';
import { Button, Input, inputVariants } from '@repo/ui';
import { cn } from '@repo/ui';
import { useT } from '@/i18n/use-locale';

/** Native `<select>` styled like `Input`, with a visible label. */
export function FilterSelect({
  label,
  className,
  children,
  ...props
}: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body-s text-text-muted">
        {label}
      </label>
      <select
        id={id}
        className={cn(inputVariants({ size: 'md' }), 'min-w-40', className)}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

/** Search box that applies on submit (one request per search, not per keystroke). */
export function SearchForm({
  value,
  onSearch,
  placeholder,
}: {
  value: string;
  onSearch: (value: string) => void;
  placeholder: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(draft.trim());
  }
  return (
    <form onSubmit={submit} role="search" className="flex items-end gap-2">
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={draft}
        maxLength={100}
        onChange={(e) => setDraft(e.target.value)}
        className="w-64 max-w-full"
      />
      <Button type="submit" variant="secondary">
        {t('admin.platform.common.search')}
      </Button>
    </form>
  );
}

/** Row that holds a page's filters; wraps on narrow screens. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}
