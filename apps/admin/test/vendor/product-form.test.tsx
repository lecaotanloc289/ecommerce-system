import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n/use-locale';
import { ProductForm } from '@/pages/vendor/product-form';
import { emptyProductForm, emptyVariant } from '@/pages/vendor/product-form-model';

const id = (suffix: string) => `01JC${suffix.padStart(22, '0')}`;

function renderForm(overrides: Partial<Parameters<typeof ProductForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const initial = {
    ...emptyProductForm('VND'),
    nameVi: 'Áo thun',
    slugVi: 'ao-thun',
    nameEn: 'T-shirt',
    slugEn: 't-shirt',
    categoryIds: [id('C1')],
    variants: [
      {
        ...emptyVariant(),
        id: id('V1'),
        sku: 'TS-1',
        price: '150000',
        stock: '5',
        stockReserved: 3,
      },
    ],
  };
  render(
    <ProductForm
      initial={initial}
      categories={[{ id: id('C1'), name: 'Clothes', depth: 0 }]}
      isNew={false}
      readOnly={false}
      submitting={false}
      onSubmit={onSubmit}
      uploadImage={() => Promise.resolve('media/x.png')}
      {...overrides}
    />,
  );
  return onSubmit;
}

beforeEach(() => useLocaleStore.setState({ locale: 'en' }));

describe('<ProductForm>', () => {
  it('submits a valid product', async () => {
    const onSubmit = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('blocks stock below the reserved quantity and says how many are reserved', async () => {
    const onSubmit = renderForm();
    expect(screen.getByText('3 reserved by open orders')).toBeTruthy();
    const stock = screen.getByLabelText('Stock on hand');
    await userEvent.clear(stock);
    await userEvent.type(stock, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Stock cannot be below the 3 units reserved.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('requires the English name', async () => {
    const onSubmit = renderForm();
    const [, nameEn] = screen.getAllByLabelText('Name');
    if (!nameEn) throw new Error('English name field missing');
    await userEvent.clear(nameEn);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByText('This field is required.')).length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('quick stock update is disabled below reserved and sends the variant id otherwise', async () => {
    const onQuickStock = vi.fn();
    renderForm({ onQuickStock });
    const button = screen.getByRole('button', { name: 'Update stock of TS-1' });
    const stock = screen.getByLabelText('Stock on hand');
    await userEvent.clear(stock);
    await userEvent.type(stock, '2');
    expect(button.hasAttribute('disabled')).toBe(true);
    await userEvent.clear(stock);
    await userEvent.type(stock, '9');
    await userEvent.click(button);
    expect(onQuickStock).toHaveBeenCalledWith(id('V1'), 9);
  });

  it('read-only (BLOCKED) has no save button and disabled fields', () => {
    renderForm({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByLabelText('Stock on hand').hasAttribute('disabled')).toBe(true);
  });
});
