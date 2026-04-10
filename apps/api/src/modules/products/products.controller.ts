import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import { ProductsService } from './products.service';
import {
  type CreateProductDto as CreateProductInput,
  type UpdateProductDto as UpdateProductInput,
  type ListProductsFilters,
  type ProductActor,
  type ProductVariant,
} from './products.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';

class AdjustStockBody {
  @IsNumber() delta: number;
  @IsString() @IsOptional() reason?: string;
  @IsString() @IsOptional() variantId?: string;
}

class SetStockBody {
  @IsNumber() stock: number;
  @IsString() @IsOptional() reason?: string;
  @IsString() @IsOptional() variantId?: string;
}

class TagBody {
  @IsString() tag: string;
}

class VariantBody {
  @IsString() name: string;
  @IsString() @IsOptional() sku?: string;
  @IsNumber() @IsOptional() price?: number;
  @IsNumber() @IsOptional() stock?: number;
}

class BulkIdsBody {
  @IsArray() @IsString({ each: true }) ids: string[];
}

class BulkCategoryBody {
  @IsArray() @IsString({ each: true }) ids: string[];
  @IsString() @IsOptional() category?: string | null;
}

function userActor(user: User): ProductActor {
  return { type: 'user', userId: user.id };
}

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  // ── Reads ──────────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('isActive') isActive?: string,
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
    @Query('priceMin') priceMin?: string,
    @Query('priceMax') priceMax?: string,
    @Query('stockMin') stockMin?: string,
    @Query('inStockOnly') inStockOnly?: string,
    @Query('archived') archived?: string,
    @Query('sort') sort?: ListProductsFilters['sort'],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.companyId, {
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      category,
      tag,
      search,
      priceMin: priceMin ? Number(priceMin) : undefined,
      priceMax: priceMax ? Number(priceMax) : undefined,
      stockMin: stockMin ? Number(stockMin) : undefined,
      inStockOnly: inStockOnly === 'true',
      archived: archived === 'true',
      sort,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('stats')
  stats(@CurrentUser() user: User) {
    return this.svc.stats(user.companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Get(':id/timeline')
  timeline(@CurrentUser() user: User, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.getTimeline(user.companyId, id, limit ? Number(limit) : 100);
  }

  // ── Writes ─────────────────────────────────────────────────────────────

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateProductInput) {
    return this.svc.create(user.companyId, body, userActor(user));
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: UpdateProductInput) {
    return this.svc.update(user.companyId, id, body, userActor(user));
  }

  @Post(':id/stock/adjust')
  @ApiOperation({ summary: 'Adjust stock by delta (positive to add, negative to subtract)' })
  adjustStock(@CurrentUser() user: User, @Param('id') id: string, @Body() body: AdjustStockBody) {
    return this.svc.adjustStock(user.companyId, id, body, userActor(user));
  }

  @Post(':id/stock/set')
  @ApiOperation({ summary: 'Set stock to an absolute value' })
  setStock(@CurrentUser() user: User, @Param('id') id: string, @Body() body: SetStockBody) {
    return this.svc.setStock(user.companyId, id, body, userActor(user));
  }

  @Post(':id/tags')
  addTag(@CurrentUser() user: User, @Param('id') id: string, @Body() body: TagBody) {
    return this.svc.addTag(user.companyId, id, body.tag, userActor(user));
  }

  @Delete(':id/tags/:tag')
  removeTag(@CurrentUser() user: User, @Param('id') id: string, @Param('tag') tag: string) {
    return this.svc.removeTag(user.companyId, id, tag, userActor(user));
  }

  @Post(':id/archive')
  archive(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.archive(user.companyId, id, userActor(user));
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.unarchive(user.companyId, id, userActor(user));
  }

  // ── Variants ─────────────────────────────────────────────────────────────

  @Post(':id/variants')
  addVariant(@CurrentUser() user: User, @Param('id') id: string, @Body() body: VariantBody) {
    return this.svc.addVariant(user.companyId, id, body, userActor(user));
  }

  @Patch(':id/variants/:variantId')
  updateVariant(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() body: Partial<ProductVariant>,
  ) {
    return this.svc.updateVariant(user.companyId, id, variantId, body, userActor(user));
  }

  @Delete(':id/variants/:variantId')
  removeVariant(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
  ) {
    return this.svc.removeVariant(user.companyId, id, variantId, userActor(user));
  }

  // ── Bulk + delete ───────────────────────────────────────────────────────

  @Post('bulk/archive')
  bulkArchive(@CurrentUser() user: User, @Body() body: BulkIdsBody) {
    return this.svc.bulkArchive(user.companyId, body.ids, userActor(user));
  }

  @Post('bulk/unarchive')
  bulkUnarchive(@CurrentUser() user: User, @Body() body: BulkIdsBody) {
    return this.svc.bulkUnarchive(user.companyId, body.ids, userActor(user));
  }

  @Post('bulk/delete')
  bulkDelete(@CurrentUser() user: User, @Body() body: BulkIdsBody) {
    return this.svc.bulkDelete(user.companyId, body.ids, userActor(user));
  }

  @Post('bulk/category')
  bulkCategory(@CurrentUser() user: User, @Body() body: BulkCategoryBody) {
    return this.svc.bulkSetCategory(user.companyId, body.ids, body.category ?? null, userActor(user));
  }

  @Delete(':id')
  delete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.delete(user.companyId, id, userActor(user));
  }
}
