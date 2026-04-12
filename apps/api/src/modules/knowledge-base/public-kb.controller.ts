/**
 * Public Knowledge Base endpoints — NO authentication.
 *
 * GET /public/kb          — paginated list of published public articles
 * GET /public/kb/:slug    — full article content, fire-and-forget viewCount++
 */
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { KnowledgeBaseService } from './knowledge-base.service';

@ApiTags('public-kb')
@Controller('public/kb')
export class PublicKBController {
  constructor(private readonly svc: KnowledgeBaseService) {}

  @Get()
  async list(@Query('limit') limit?: string) {
    return this.svc.listPublic(limit ? Number(limit) : 50);
  }

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    const article = await this.svc.getPublicBySlug(slug);
    if (!article) throw new NotFoundException('Article not found');
    void this.svc.incrementViewCount(slug).catch(() => undefined);
    return article;
  }
}
