/**
 * Forms service — single write path for every form mutation.
 *
 * Mirrors `CampaignsService` / `LeadsService` / `DealsService`: every
 * state-changing method ends with a call to `logActivity` so we get a
 * complete audit trail in `FormActivity` attributed to the original
 * actor (user / ai / system / worker / public).
 *
 * The hot path is `submit()` — called by both the public renderer and
 * the API-key webhook. It validates against the form's field list, runs
 * configured auto-actions (auto-create lead / enrol in sequence /
 * forward to external webhook), and records the per-submission activity.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { prisma } from '@wacrm/database';
import type {
  Form,
  FormActivityType,
  FormStatus,
  FormSubmission,
  LeadSource,
  Prisma,
} from '@wacrm/database';
import { encrypt } from '@wacrm/shared';

import { LeadsService } from '../leads/leads.service';
import type { CreateLeadDto } from '../leads/leads.types';

import {
  pickContactFromSubmission,
  slugify,
  validateFieldDef,
  validateSubmission,
} from './forms.validation';
import type {
  AddFormActivityInput,
  AutoActionsConfig,
  BulkMutationResult,
  CreateFormDto,
  FormActor,
  FormField,
  FormStatsSnapshot,
  ListFormsFilters,
  ListSubmissionsFilters,
  PublicFormDefinition,
  SubmissionMeta,
  SubmissionPayload,
  SubmitResult,
  UpdateFormDto,
} from './forms.types';

@Injectable()
export class FormsService {
  constructor(private readonly leads: LeadsService) {}

  // ── Reads ─────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListFormsFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const where: Prisma.FormWhereInput = { companyId };

    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    if (filters.tag) where.tags = { has: filters.tag };
    if (filters.createdFrom || filters.createdTo) {
      where.createdAt = {};
      if (filters.createdFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(filters.createdFrom);
      if (filters.createdTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(filters.createdTo);
    }
    if (filters.search) {
      const q = filters.search;
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.FormOrderByWithRelationInput =
      filters.sort === 'name'
        ? { name: 'asc' }
        : filters.sort === 'submissions'
          ? { submitCount: 'desc' }
          : filters.sort === 'conversion'
            ? { convertedCount: 'desc' }
            : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      prisma.form.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.form.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const record = await prisma.form.findFirst({
      where: { id, companyId },
      include: {
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!record) throw new NotFoundException('Form not found');
    return record;
  }

  async getBySlug(companyId: string, slug: string): Promise<Form> {
    const record = await prisma.form.findUnique({
      where: { companyId_slug: { companyId, slug } },
    });
    if (!record) throw new NotFoundException('Form not found');
    return record;
  }

  /** Public renderer lookup — returns the definition only when eligible. */
  async getPublicDefinitionBySlug(slug: string): Promise<PublicFormDefinition | null> {
    const record = await prisma.form.findFirst({
      where: { slug, status: 'ACTIVE', isPublic: true },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        fields: true,
        requireCaptcha: true,
      },
    });
    if (!record) return null;
    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      description: record.description,
      fields: (record.fields as unknown as FormField[]) ?? [],
      requireCaptcha: record.requireCaptcha,
    };
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.getRaw(companyId, id);
    return prisma.formActivity.findMany({
      where: { formId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    });
  }

  async listSubmissions(
    companyId: string,
    id: string,
    filters: ListSubmissionsFilters = {},
  ) {
    await this.getRaw(companyId, id);
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(500, Math.max(1, filters.limit ?? 100));
    const where: Prisma.FormSubmissionWhereInput = { formId: id, companyId };
    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    const [items, total] = await Promise.all([
      prisma.formSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.formSubmission.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getSubmission(companyId: string, id: string, submissionId: string) {
    const record = await prisma.formSubmission.findFirst({
      where: { id: submissionId, formId: id, companyId },
    });
    if (!record) throw new NotFoundException('Submission not found');
    return record;
  }

  async stats(companyId: string, days = 30): Promise<FormStatsSnapshot> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const forms = await prisma.form.findMany({
      where: { companyId, createdAt: { gte: since } },
      select: {
        status: true,
        submitCount: true,
        convertedCount: true,
        spamCount: true,
      },
    });

    const byStatus: Record<string, number> = {};
    let totalSubmissions = 0;
    let totalConverted = 0;
    let totalSpam = 0;
    for (const f of forms) {
      byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
      totalSubmissions += f.submitCount;
      totalConverted += f.convertedCount;
      totalSpam += f.spamCount;
    }

    return {
      rangeDays: days,
      totalForms: forms.length,
      byStatus,
      activeForms: byStatus['ACTIVE'] ?? 0,
      totalSubmissions,
      totalConverted,
      totalSpam,
      conversionRate:
        totalSubmissions > 0
          ? Math.round((totalConverted / totalSubmissions) * 1000) / 10
          : null,
      spamRate:
        totalSubmissions > 0
          ? Math.round((totalSpam / totalSubmissions) * 1000) / 10
          : null,
    };
  }

  // ── Writes ────────────────────────────────────────────────────────────

  async create(
    companyId: string,
    actor: FormActor,
    dto: CreateFormDto,
  ): Promise<Form> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    const fields = dto.fields ?? [];
    for (const f of fields) {
      const errs = validateFieldDef(f);
      if (errs.length > 0) throw new BadRequestException(errs.join('; '));
    }

    const slug = await this.uniqueSlug(companyId, dto.name);

    const form = await prisma.form.create({
      data: {
        companyId,
        name: dto.name.trim(),
        slug,
        description: dto.description,
        fields: fields as unknown as Prisma.InputJsonValue,
        priority: dto.priority ?? 'MEDIUM',
        tags: dto.tags ?? [],
        notes: dto.notes,
        createdByUserId: actor.type === 'user' ? actor.userId : null,
      },
    });
    await this.logActivity(companyId, form.id, actor, {
      type: 'CREATED',
      title: `Form "${form.name}" created`,
      metadata: { slug: form.slug, fieldCount: fields.length },
    });
    return form;
  }

  async update(
    companyId: string,
    id: string,
    actor: FormActor,
    dto: UpdateFormDto,
  ): Promise<Form> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException(
        `Cannot edit an archived form. Restore it first.`,
      );
    }
    const data: Prisma.FormUpdateInput = {};
    const diffs: Array<{ field: string; from: unknown; to: unknown }> = [];
    const assign = <K extends keyof UpdateFormDto>(field: K) => {
      if (dto[field] === undefined) return;
      const newVal = dto[field];
      const oldVal = (existing as unknown as Record<string, unknown>)[field as string];
      if (newVal !== oldVal) {
        diffs.push({ field: field as string, from: oldVal, to: newVal });
        (data as Record<string, unknown>)[field as string] = newVal;
      }
    };
    assign('name');
    assign('description');
    assign('priority');
    assign('tags');
    assign('notes');
    assign('isPublic');
    assign('requireCaptcha');
    assign('rateLimitPerHour');

    if (diffs.length === 0) return existing;

    const updated = await prisma.form.update({ where: { id }, data });
    for (const d of diffs) {
      await this.logActivity(companyId, id, actor, {
        type: d.field === 'name' ? 'RENAMED' : 'FIELD_UPDATED',
        title: `${d.field} updated`,
        body: `${safeDisplay(d.from)} → ${safeDisplay(d.to)}`,
        metadata: { field: d.field, from: d.from, to: d.to },
      });
    }
    return updated;
  }

  async addField(
    companyId: string,
    id: string,
    actor: FormActor,
    field: FormField,
  ): Promise<Form> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot modify an archived form');
    }
    const errs = validateFieldDef(field);
    if (errs.length > 0) throw new BadRequestException(errs.join('; '));

    const fields = this.parseFields(existing.fields);
    if (fields.some((f) => f.key === field.key)) {
      throw new BadRequestException(`Field key "${field.key}" already exists`);
    }
    fields.push(field);
    const updated = await prisma.form.update({
      where: { id },
      data: { fields: fields as unknown as Prisma.InputJsonValue },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'FIELD_ADDED',
      title: `Field "${field.label}" added`,
      metadata: { key: field.key, type: field.type },
    });
    return updated;
  }

  async removeField(
    companyId: string,
    id: string,
    actor: FormActor,
    key: string,
  ): Promise<Form> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot modify an archived form');
    }
    const fields = this.parseFields(existing.fields);
    const before = fields.length;
    const remaining = fields.filter((f) => f.key !== key);
    if (remaining.length === before) {
      throw new BadRequestException(`Field "${key}" not found`);
    }
    const updated = await prisma.form.update({
      where: { id },
      data: { fields: remaining as unknown as Prisma.InputJsonValue },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'FIELD_REMOVED',
      title: `Field "${key}" removed`,
      metadata: { key },
    });
    return updated;
  }

  async reorderFields(
    companyId: string,
    id: string,
    actor: FormActor,
    keys: string[],
  ): Promise<Form> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot modify an archived form');
    }
    const fields = this.parseFields(existing.fields);
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const reordered: FormField[] = [];
    for (const k of keys) {
      const f = byKey.get(k);
      if (!f) throw new BadRequestException(`Field "${k}" not in form`);
      reordered.push(f);
      byKey.delete(k);
    }
    // Append any fields not in the keys array (defensive — caller should pass all keys)
    for (const f of byKey.values()) reordered.push(f);
    const updated = await prisma.form.update({
      where: { id },
      data: { fields: reordered as unknown as Prisma.InputJsonValue },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'FIELDS_REORDERED',
      title: 'Fields reordered',
      metadata: { order: reordered.map((f) => f.key) },
    });
    return updated;
  }

  async setAutoActions(
    companyId: string,
    id: string,
    actor: FormActor,
    config: AutoActionsConfig,
  ): Promise<Form> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot modify an archived form');
    }

    const data: Prisma.FormUpdateInput = {};
    if (config.autoCreateLead !== undefined) data.autoCreateLead = config.autoCreateLead;
    if (config.autoLeadSource !== undefined) data.autoLeadSource = config.autoLeadSource;
    if (config.autoLeadTitle !== undefined) data.autoLeadTitle = config.autoLeadTitle;
    if (config.autoEnrollSequenceId !== undefined) data.autoEnrollSequenceId = config.autoEnrollSequenceId;
    if (config.autoAssignUserId !== undefined) data.autoAssignUserId = config.autoAssignUserId;
    if (config.autoTagContact !== undefined) data.autoTagContact = config.autoTagContact;
    if (config.webhookForwardUrl !== undefined) data.webhookForwardUrl = config.webhookForwardUrl;

    const updated = await prisma.form.update({ where: { id }, data });
    await this.logActivity(companyId, id, actor, {
      type: 'AUTO_ACTIONS_UPDATED',
      title: 'Auto-actions updated',
      metadata: config as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async publish(
    companyId: string,
    id: string,
    actor: FormActor,
  ): Promise<Form> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'PAUSED') {
      throw new BadRequestException(
        `Only DRAFT or PAUSED forms can be published (current: ${existing.status})`,
      );
    }
    const fields = this.parseFields(existing.fields);
    if (fields.length === 0) {
      throw new BadRequestException('Add at least one field before publishing');
    }
    const updated = await prisma.form.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        publishedAt: existing.publishedAt ?? new Date(),
      },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'PUBLISHED',
      title: 'Form published',
      metadata: { fieldCount: fields.length },
    });
    return updated;
  }

  async unpublish(
    companyId: string,
    id: string,
    actor: FormActor,
  ): Promise<Form> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Only ACTIVE forms can be unpublished (current: ${existing.status})`,
      );
    }
    const updated = await prisma.form.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'UNPUBLISHED',
      title: 'Form unpublished',
    });
    return updated;
  }

  async archive(
    companyId: string,
    id: string,
    actor: FormActor,
  ): Promise<Form> {
    const existing = await this.getRaw(companyId, id);
    const updated = await prisma.form.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'ARCHIVED',
      title: 'Form archived',
      metadata: { prevStatus: existing.status },
    });
    return updated;
  }

  async restore(
    companyId: string,
    id: string,
    actor: FormActor,
  ): Promise<Form> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'ARCHIVED') {
      throw new BadRequestException(
        `Only ARCHIVED forms can be restored (current: ${existing.status})`,
      );
    }
    const updated = await prisma.form.update({
      where: { id },
      data: { status: 'DRAFT' },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'RESTORED',
      title: 'Form restored',
    });
    return updated;
  }

  async duplicate(
    companyId: string,
    id: string,
    actor: FormActor,
  ): Promise<Form> {
    const src = await this.getRaw(companyId, id);
    const newName = `${src.name} (copy)`;
    const newSlug = await this.uniqueSlug(companyId, newName);
    const dup = await prisma.form.create({
      data: {
        companyId,
        name: newName,
        slug: newSlug,
        description: src.description,
        fields: src.fields as unknown as Prisma.InputJsonValue,
        priority: src.priority,
        tags: src.tags,
        notes: src.notes,
        isPublic: false, // copies start unpublished
        requireCaptcha: src.requireCaptcha,
        rateLimitPerHour: src.rateLimitPerHour,
        autoCreateLead: src.autoCreateLead,
        autoLeadSource: src.autoLeadSource,
        autoLeadTitle: src.autoLeadTitle,
        autoEnrollSequenceId: src.autoEnrollSequenceId,
        autoAssignUserId: src.autoAssignUserId,
        autoTagContact: src.autoTagContact,
        createdByUserId: actor.type === 'user' ? actor.userId : null,
      },
    });
    await this.logActivity(companyId, dup.id, actor, {
      type: 'DUPLICATED',
      title: `Duplicated from "${src.name}"`,
      metadata: { sourceFormId: src.id },
    });
    return dup;
  }

  async addNote(
    companyId: string,
    id: string,
    actor: FormActor,
    body: string,
  ): Promise<void> {
    await this.getRaw(companyId, id);
    if (!body?.trim()) throw new BadRequestException('note body required');
    await this.logActivity(companyId, id, actor, {
      type: 'NOTE_ADDED',
      title: 'Note',
      body: body.trim(),
    });
  }

  async rotateWebhookSecret(
    companyId: string,
    id: string,
    actor: FormActor,
  ): Promise<{ secret: string }> {
    const existing = await this.getRaw(companyId, id);
    const rawSecret = randomBytes(32).toString('hex');
    const encrypted = encrypt(rawSecret);
    await prisma.form.update({
      where: { id: existing.id },
      data: { webhookForwardSecret: encrypted },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'WEBHOOK_ROTATED',
      title: 'Webhook forward secret rotated',
    });
    // Return the raw secret ONCE — never stored unencrypted on the Form row.
    return { secret: rawSecret };
  }

  async remove(companyId: string, id: string): Promise<void> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'ARCHIVED') {
      throw new BadRequestException(
        `Only DRAFT or ARCHIVED forms can be deleted (current: ${existing.status})`,
      );
    }
    await prisma.form.delete({ where: { id } });
  }

  // ── Bulk ops ──────────────────────────────────────────────────────────

  async bulkPublish(
    companyId: string,
    ids: string[],
    actor: FormActor,
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.publish(companyId, id, actor));
  }

  async bulkUnpublish(
    companyId: string,
    ids: string[],
    actor: FormActor,
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.unpublish(companyId, id, actor));
  }

  async bulkArchive(
    companyId: string,
    ids: string[],
    actor: FormActor,
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.archive(companyId, id, actor));
  }

  async bulkDelete(
    companyId: string,
    ids: string[],
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.remove(companyId, id));
  }

  // ── Submission (the hot path) ─────────────────────────────────────────

  /**
   * Ingest a submission against a form identified by id or slug. Called
   * from the JWT controller (manual form fills), the public renderer
   * endpoint, and the API-key webhook.
   *
   * Steps:
   *   1. Resolve form by id-or-slug
   *   2. Check it's accepting submissions (ACTIVE; public actors also need isPublic)
   *   3. Rate-limit check (best-effort via recent submission count)
   *   4. Validate payload against field definitions
   *   5. Create FormSubmission row
   *   6. Run auto-actions (create-lead / assign / tag / forward)
   *   7. Fire webhook forward (best-effort, fire-and-forget)
   *   8. Bump counters + log activity
   */
  async submit(
    companyId: string,
    formIdOrSlug: string,
    payload: SubmissionPayload,
    meta: SubmissionMeta,
  ): Promise<SubmitResult> {
    const form = await this.resolveFormForSubmission(companyId, formIdOrSlug);

    if (form.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Form is not accepting submissions (status: ${form.status})`,
      );
    }
    if (meta.actor.type === 'public' && !form.isPublic) {
      throw new NotFoundException('Form not found');
    }

    // Rate limit (best-effort): count submissions in the last hour from this IP
    if (meta.ipAddress && form.rateLimitPerHour > 0) {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await prisma.formSubmission.count({
        where: {
          formId: form.id,
          companyId,
          ipAddress: meta.ipAddress,
          createdAt: { gte: since },
        },
      });
      if (recent >= form.rateLimitPerHour) {
        throw new BadRequestException('Rate limit exceeded for this IP');
      }
    }

    // Validate against field definitions
    const fields = this.parseFields(form.fields);
    const { ok, errors, normalized } = validateSubmission(fields, payload);
    if (!ok) {
      // Still store the raw payload so form designers can audit what failed
      const badSub = await prisma.formSubmission.create({
        data: {
          formId: form.id,
          companyId,
          data: payload as Prisma.InputJsonValue,
          status: 'SPAM',
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          referrer: meta.referrer,
          utmSource: meta.utm?.source,
          utmMedium: meta.utm?.medium,
          utmCampaign: meta.utm?.campaign,
          errorReason: `Validation failed: ${Object.values(errors).join('; ').slice(0, 500)}`,
        },
      });
      await prisma.form.update({
        where: { id: form.id },
        data: { submitCount: { increment: 1 }, spamCount: { increment: 1 } },
      });
      await this.logActivity(companyId, form.id, meta.actor, {
        type: 'SUBMISSION_MARKED_SPAM',
        title: 'Submission failed validation',
        body: `${Object.keys(errors).length} field error(s)`,
        metadata: { submissionId: badSub.id, errors },
      });
      return {
        submissionId: badSub.id,
        status: 'SPAM',
        validationErrors: errors,
      };
    }

    const submission = await prisma.formSubmission.create({
      data: {
        formId: form.id,
        companyId,
        data: normalized as Prisma.InputJsonValue,
        status: 'RECEIVED',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        referrer: meta.referrer,
        utmSource: meta.utm?.source,
        utmMedium: meta.utm?.medium,
        utmCampaign: meta.utm?.campaign,
      },
    });
    await prisma.form.update({
      where: { id: form.id },
      data: { submitCount: { increment: 1 } },
    });
    await this.logActivity(companyId, form.id, meta.actor, {
      type: 'SUBMISSION_RECEIVED',
      title: 'New submission',
      metadata: {
        submissionId: submission.id,
        utm: meta.utm,
        ipAddress: meta.ipAddress,
      },
    });

    // Run auto-actions
    let leadId: string | undefined;
    let contactId: string | undefined;
    if (form.autoCreateLead) {
      try {
        const contactHints = pickContactFromSubmission(normalized);
        if (contactHints.phoneNumber || contactHints.email) {
          const leadDto: CreateLeadDto = {
            phoneNumber: contactHints.phoneNumber,
            contactName: contactHints.displayName,
            title: renderAutoTitle(form.autoLeadTitle, form.name, normalized),
            source: (form.autoLeadSource as LeadSource | undefined) ?? 'FORM',
            tags: form.autoTagContact.length > 0 ? form.autoTagContact : undefined,
            assignedAgentId: form.autoAssignUserId ?? undefined,
            customFields: {
              formId: form.id,
              formSlug: form.slug,
              submissionId: submission.id,
              email: contactHints.email,
            },
            force: true, // forms can legitimately create multiple leads per contact
          };
          const lead = await this.leads.create(companyId, leadDto, {
            type: 'system',
          });
          leadId = lead.id;
          contactId = lead.contactId;
          await prisma.formSubmission.update({
            where: { id: submission.id },
            data: {
              leadId,
              contactId,
              status: 'CONVERTED',
              processedAt: new Date(),
            },
          });
          await prisma.form.update({
            where: { id: form.id },
            data: { convertedCount: { increment: 1 } },
          });
          await this.logActivity(companyId, form.id, meta.actor, {
            type: 'SUBMISSION_CONVERTED',
            title: `Converted submission to lead`,
            metadata: { submissionId: submission.id, leadId, contactId },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.formSubmission.update({
          where: { id: submission.id },
          data: { errorReason: msg.slice(0, 500) },
        });
        await this.logActivity(companyId, form.id, meta.actor, {
          type: 'ERROR',
          title: 'Auto-lead creation failed',
          body: msg.slice(0, 500),
          metadata: { submissionId: submission.id },
        });
      }
    }

    // Forward webhook (fire-and-forget)
    if (form.webhookForwardUrl) {
      void this.forwardWebhook(form, normalized).catch(() => {
        // Best-effort — errors are logged, not thrown.
      });
    }

    return {
      submissionId: submission.id,
      status: leadId ? 'CONVERTED' : 'RECEIVED',
      leadId,
      contactId,
    };
  }

  async convertSubmissionToLead(
    companyId: string,
    submissionId: string,
    actor: FormActor,
    overrides: Partial<CreateLeadDto> = {},
  ): Promise<{ leadId: string; contactId?: string }> {
    const sub = await prisma.formSubmission.findFirst({
      where: { id: submissionId, companyId },
      include: { form: true },
    });
    if (!sub) throw new NotFoundException('Submission not found');
    if (sub.status === 'CONVERTED' && sub.leadId) {
      return { leadId: sub.leadId, contactId: sub.contactId ?? undefined };
    }
    const data = sub.data as Record<string, unknown>;
    const hints = pickContactFromSubmission(data);
    const dto: CreateLeadDto = {
      phoneNumber: hints.phoneNumber,
      contactName: hints.displayName,
      title: overrides.title ?? `Lead from form ${sub.form.name}`,
      source: (overrides.source ?? 'FORM') as LeadSource,
      tags: overrides.tags,
      force: true,
      ...overrides,
      customFields: {
        formId: sub.formId,
        formSlug: sub.form.slug,
        submissionId: sub.id,
        email: hints.email,
        ...(overrides.customFields ?? {}),
      },
    };
    if (!dto.phoneNumber && !hints.email) {
      throw new BadRequestException(
        'Submission has no phone or email — cannot create a lead',
      );
    }
    const lead = await this.leads.create(companyId, dto, {
      type: actor.type === 'user' ? 'user' : 'system',
      ...(actor.type === 'user' ? { userId: actor.userId } : {}),
    } as never);
    await prisma.formSubmission.update({
      where: { id: sub.id },
      data: {
        status: 'CONVERTED',
        leadId: lead.id,
        contactId: lead.contactId,
        processedAt: new Date(),
      },
    });
    await prisma.form.update({
      where: { id: sub.formId },
      data: { convertedCount: { increment: 1 } },
    });
    await this.logActivity(companyId, sub.formId, actor, {
      type: 'SUBMISSION_CONVERTED',
      title: 'Manually converted to lead',
      metadata: { submissionId: sub.id, leadId: lead.id },
    });
    return { leadId: lead.id, contactId: lead.contactId };
  }

  async markSubmissionSpam(
    companyId: string,
    submissionId: string,
    actor: FormActor,
  ): Promise<FormSubmission> {
    const sub = await prisma.formSubmission.findFirst({
      where: { id: submissionId, companyId },
    });
    if (!sub) throw new NotFoundException('Submission not found');
    const updated = await prisma.formSubmission.update({
      where: { id: sub.id },
      data: { status: 'SPAM', processedAt: new Date() },
    });
    await prisma.form.update({
      where: { id: sub.formId },
      data: { spamCount: { increment: 1 } },
    });
    await this.logActivity(companyId, sub.formId, actor, {
      type: 'SUBMISSION_MARKED_SPAM',
      title: 'Submission marked as spam',
      metadata: { submissionId: sub.id },
    });
    return updated;
  }

  async deleteSubmission(
    companyId: string,
    submissionId: string,
  ): Promise<void> {
    const sub = await prisma.formSubmission.findFirst({
      where: { id: submissionId, companyId },
    });
    if (!sub) throw new NotFoundException('Submission not found');
    await prisma.formSubmission.delete({ where: { id: sub.id } });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async getRaw(companyId: string, id: string): Promise<Form> {
    const record = await prisma.form.findFirst({ where: { id, companyId } });
    if (!record) throw new NotFoundException('Form not found');
    return record;
  }

  private async resolveFormForSubmission(
    companyId: string,
    idOrSlug: string,
  ): Promise<Form> {
    const byId = await prisma.form.findFirst({
      where: { id: idOrSlug, companyId },
    });
    if (byId) return byId;
    const bySlug = await prisma.form.findUnique({
      where: { companyId_slug: { companyId, slug: idOrSlug } },
    });
    if (!bySlug) throw new NotFoundException('Form not found');
    return bySlug;
  }

  private async uniqueSlug(companyId: string, name: string): Promise<string> {
    let base = slugify(name);
    if (!base) base = 'form';
    let candidate = base;
    let i = 1;
    while (
      await prisma.form.findUnique({
        where: { companyId_slug: { companyId, slug: candidate } },
      })
    ) {
      i++;
      candidate = `${base}-${i}`;
      if (i > 100) {
        candidate = `${base}-${randomBytes(3).toString('hex')}`;
        break;
      }
    }
    return candidate;
  }

  private parseFields(raw: unknown): FormField[] {
    if (!Array.isArray(raw)) return [];
    return raw as FormField[];
  }

  private async forwardWebhook(
    form: Form,
    normalized: Record<string, unknown>,
  ): Promise<void> {
    if (!form.webhookForwardUrl) return;
    const body = JSON.stringify({
      formId: form.id,
      formSlug: form.slug,
      formName: form.name,
      data: normalized,
      timestamp: new Date().toISOString(),
    });
    try {
      await fetch(form.webhookForwardUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'OpenAgentCRM-Forms/1.0',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Swallowed by caller — fire-and-forget.
    }
  }

  private async runBulk(
    ids: string[],
    op: (id: string) => Promise<unknown>,
  ): Promise<BulkMutationResult> {
    let updated = 0;
    let failed = 0;
    const errors: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try {
        await op(id);
        updated++;
      } catch (err) {
        failed++;
        errors.push({
          id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { updated, failed, errors };
  }

  private async logActivity(
    companyId: string,
    formId: string,
    actor: FormActor,
    input: AddFormActivityInput,
  ) {
    return prisma.formActivity.create({
      data: {
        formId,
        companyId,
        type: input.type,
        actorType: actor.type,
        actorId: actor.type === 'user' ? actor.userId : null,
        title: input.title,
        body: input.body,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}

// ── Local helpers ───────────────────────────────────────────────────────

function safeDisplay(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.join(', ') || '[]';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function renderAutoTitle(
  template: string | null | undefined,
  fallbackName: string,
  vars: Record<string, unknown>,
): string {
  if (!template) return `Lead from form "${fallbackName}"`;
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => {
    const v = vars[k];
    if (v === null || v === undefined) return m;
    return String(v);
  });
}

// Type reference to suppress unused-import warnings for enum types
// that are used for downstream inference.
const _TYPE_GUARD: Array<FormStatus | FormActivityType> = [];
void _TYPE_GUARD;
