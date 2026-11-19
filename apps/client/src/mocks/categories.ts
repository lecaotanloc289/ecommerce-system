import type { Brand, Category } from '../types';

const img = (seed: string) => `https://picsum.photos/seed/${seed}/480/360`;

export const categories: Category[] = [
  { id: 'c1', slug: 'audio', name: 'Audio', icon: '🎧', productCount: 42, image: img('cat-audio') },
  {
    id: 'c2',
    slug: 'cameras',
    name: 'Cameras',
    icon: '📷',
    productCount: 28,
    image: img('cat-cameras'),
  },
  {
    id: 'c3',
    slug: 'computers',
    name: 'Computers',
    icon: '💻',
    productCount: 65,
    image: img('cat-computers'),
  },
  {
    id: 'c4',
    slug: 'wearables',
    name: 'Wearables',
    icon: '⌚',
    productCount: 31,
    image: img('cat-wearables'),
  },
  {
    id: 'c5',
    slug: 'accessories',
    name: 'Accessories',
    icon: '🖱️',
    productCount: 88,
    image: img('cat-accessories'),
  },
  {
    id: 'c6',
    slug: 'fashion',
    name: 'Fashion',
    icon: '👕',
    productCount: 120,
    image: img('cat-fashion'),
  },
];

export const brands: Brand[] = [
  { id: 'b1', name: 'Apple', logo: '' },
  { id: 'b2', name: 'Samsung', logo: '' },
  { id: 'b3', name: 'Sony', logo: '' },
  { id: 'b4', name: 'Xiaomi', logo: '' },
  { id: 'b5', name: 'Asus', logo: '' },
  { id: 'b6', name: 'Lenovo', logo: '' },
  { id: 'b7', name: 'Huawei', logo: '' },
  { id: 'b8', name: 'Wacom', logo: '' },
  { id: 'b9', name: 'Barbour', logo: '' },
  { id: 'b10', name: 'Converse', logo: '' },
];
