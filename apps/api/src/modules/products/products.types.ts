/**
 * Shared types for the Products module — DTOs, filter shapes, and the
 * ProductActor tagged union used by every mutation in `ProductsService`
 * so each `ProductActivity` row is correctly attributed.
 */
import type { ProductActivityType } from '@wacrm/database';

export type ProductActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' };

export interface ProductVariant {
  id: string;
  name: string;
  sku?: string;
  price?: number;       // overrides base price; smallest unit
  stock?: number;       // overrides base stock
  attributes?: Record<string, string>; // {color: 'red', size: 'L'}
}

export interface CreateProductDto {
  name: string;
  description?: string;
  price?: number;       // smallest unit
  costPrice?: number;
  currency?: string;
  sku?: string;
  barcode?: string;
  category?: string;
  tags?: string[];
  trackInventory?: boolean;
  stock?: number;
  reorderLevel?: number;
  images?: string[];
  variants?: ProductVariant[];
  isActive?: boolean;
}

export interface UpdateProductDto {
  name?: string;
  description?: string | null;
  price?: number;
  costPrice?: number | null;
  currency?: string;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  tags?: string[];
  trackInventory?: boolean;
  reorderLevel?: number;
  images?: string[];
  variants?: ProductVariant[];
  isActive?: boolean;
}

export interface ListProductsFilters {
  isActive?: boolean;
  category?: string;
  tag?: string;
  search?: string;          // matches name / description / sku / barcode
  priceMin?: number;
  priceMax?: number;
  stockMin?: number;
  inStockOnly?: boolean;
  lowStockOnly?: boolean;   // stock <= reorderLevel
  archived?: boolean;       // include archived items
  sort?: 'recent' | 'name' | 'price' | 'stock' | 'sold';
  page?: number;
  limit?: number;
}

export interface AdjustStockDto {
  delta: number;            // positive to add, negative to subtract
  reason?: string;
  variantId?: string;       // if adjusting a specific variant
}

export interface SetStockDto {
  stock: number;            // absolute value
  reason?: string;
  variantId?: string;
}

export interface AddProductActivityInput {
  type: ProductActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}
