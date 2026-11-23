import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react';
import { Button, Input } from '@repo/ui';
import { useLocale } from '@/i18n/use-locale';
import { errorMessage } from '@/lib/api-error';
import { newRowId } from '@/lib/row-id';

/** An image in the list: already stored (`id`) or just uploaded (`key`, echoed back on save). */
export interface ImageItem {
  rowId: string;
  id?: string;
  key?: string;
  url: string;
  alt: string;
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Ordered image list with upload, alt text, reorder and remove. `upload(file)` must presign + PUT
 * and resolve the object key (see `uploadFile`); array order is the display order.
 */
export function ImageListEditor({
  images,
  onChange,
  onAppend,
  upload,
  maxImages,
  disabled = false,
}: {
  images: readonly ImageItem[];
  onChange: (images: ImageItem[]) => void;
  /** Append uploaded images to the *current* list (uploads finish after the user may have edited it). */
  onAppend: (added: ImageItem[]) => void;
  upload: (file: File) => Promise<string>;
  maxImages: number;
  disabled?: boolean;
}) {
  const { t, locale } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = (index: number, delta: -1 | 1) => {
    const next = [...images];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  const addFiles = async (files: readonly File[]) => {
    setError(null);
    setBusy(true);
    const added: ImageItem[] = [];
    try {
      for (const file of files) {
        if (images.length + added.length >= maxImages) {
          setError(t('admin.vendor.images.tooMany', { max: maxImages }));
          break;
        }
        if (!IMAGE_TYPES.some((type) => type === file.type)) {
          setError(t('admin.vendor.images.badType'));
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setError(t('admin.vendor.images.tooLarge'));
          continue;
        }
        const key = await upload(file);
        const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
        added.push({ rowId: newRowId(), key, url, alt: '' });
      }
    } catch (caught) {
      setError(errorMessage(locale, caught));
    } finally {
      setBusy(false);
      if (added.length > 0) onAppend(added);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {images.map((image, index) => (
          <li
            key={image.rowId}
            className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-elevated p-2"
          >
            {image.url ? (
              <img src={image.url} alt="" className="size-14 rounded-sm object-cover" />
            ) : (
              <div className="size-14 rounded-sm bg-bg-muted" aria-hidden />
            )}
            <Input
              aria-label={t('admin.vendor.images.alt')}
              placeholder={t('admin.vendor.images.alt')}
              value={image.alt}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  images.map((item, i) =>
                    i === index ? { ...item, alt: event.target.value } : item,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('admin.vendor.images.moveUp')}
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('admin.vendor.images.moveDown')}
              disabled={disabled || index === images.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('admin.vendor.images.remove')}
              disabled={disabled}
              onClick={() => onChange(images.filter((_, i) => i !== index))}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-body-s text-danger-fg">
          {error}
        </p>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        multiple
        hidden
        data-testid="image-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void addFiles(files);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        loading={busy}
        disabled={disabled || images.length >= maxImages}
        iconLeft={<ImagePlus aria-hidden />}
        onClick={() => input.current?.click()}
      >
        {t('admin.vendor.images.add')}
      </Button>
    </div>
  );
}
