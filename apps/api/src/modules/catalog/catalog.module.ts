import { Controller, Get, HttpCode, Module, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth } from '@nestjs/swagger';
import { PERMISSIONS } from '@velora/shared';
import { Public, RequirePermissions } from '../../common/decorators';
import { SearchService } from './search.service';
import { Viewer, type ViewerRef } from '../../common/viewer';
import { CatalogService } from './catalog.service';
import { ProductService } from './product.service';
import { FacetQuery, ProductQuery, ReviewQuery, SuggestQuery } from './catalog.dto';

/** Public storefront catalogue. A valid access token, if sent, personalises results. */
@ApiTags('Catalogue')
@Public()
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly products: ProductService,
  ) {}

  @Get('storefront/home')
  home() {
    return this.products.home();
  }

  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Get('categories/:slug')
  category(@Param('slug') slug: string) {
    return this.catalog.category(slug);
  }

  @Get('brands')
  brands() {
    return this.catalog.brands();
  }

  @Get('products')
  list(@Query() q: ProductQuery) {
    return this.catalog.list(q);
  }

  @Get('products/facets')
  facets(@Query() q: FacetQuery) {
    return this.catalog.facets(q);
  }

  @Get('products/:slug')
  detail(@Param('slug') slug: string) {
    return this.products.detail(slug);
  }

  @Get('products/:slug/reviews')
  reviews(@Param('slug') slug: string, @Query() q: ReviewQuery) {
    return this.products.reviews(slug, q);
  }

  @Get('products/:slug/related')
  related(@Param('slug') slug: string) {
    return this.products.related(slug);
  }

  @Post('products/:id/views')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  view(@Param('id', ParseIntPipe) id: number, @Viewer() viewer: ViewerRef) {
    return this.products.recordView(id, viewer);
  }

  @Get('search/suggest')
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  suggest(@Query() q: SuggestQuery) {
    return this.catalog.suggest(q.q);
  }

  @Get('search/trending')
  trending() {
    return this.catalog.trendingSearches();
  }

  @Get('recently-viewed')
  recentlyViewed(@Viewer() viewer: ViewerRef) {
    return this.products.recentlyViewed(viewer);
  }

  @Get('recommendations')
  recommendations(@Viewer() viewer: ViewerRef) {
    return this.products.recommendations(viewer);
  }
}

@ApiTags('Admin · Search')
@ApiBearerAuth()
@Controller('admin/search')
export class AdminSearchController {
  constructor(private readonly search: SearchService) {}

  @Post('reindex') @HttpCode(200) @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  reindex() { return this.search.reindex(); }
}

@Module({
  controllers: [CatalogController, AdminSearchController],
  providers: [CatalogService, ProductService, SearchService],
  exports: [CatalogService, SearchService],
})
export class CatalogModule {}
