import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { normalizePhone } from '@wacrm/shared';

export interface CreateContactDto {
  phoneNumber: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  notes?: string;
}

@Injectable()
export class ContactsService {
  async list(companyId: string, opts: { search?: string; tag?: string; status?: string | string[]; page?: string | number; limit?: string | number }) {
    const page = Number(opts.page) || 1;
    const limit = Math.min(Number(opts.limit) || 50, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {
      companyId,
      deletedAt: null,
      ...(opts.tag ? { tags: { has: opts.tag } } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.search
        ? {
            OR: [
              { phoneNumber: { contains: opts.search } },
              { displayName: { contains: opts.search, mode: 'insensitive' as const } },
              { firstName: { contains: opts.search, mode: 'insensitive' as const } },
              { lastName: { contains: opts.search, mode: 'insensitive' as const } },
              { email: { contains: opts.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.contact.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.contact.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async get(companyId: string, id: string) {
    const contact = await prisma.contact.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async create(companyId: string, dto: CreateContactDto) {
    const phoneNumber = normalizePhone(dto.phoneNumber);
    return prisma.contact.upsert({
      where: { companyId_phoneNumber: { companyId, phoneNumber } },
      create: {
        companyId,
        phoneNumber,
        displayName: dto.displayName,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        tags: dto.tags ?? [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        customFields: (dto.customFields ?? {}) as any,
        notes: dto.notes,
      },
      update: {
        // Update name if provided and not set yet
        ...(dto.displayName ? { displayName: dto.displayName } : {}),
        ...(dto.firstName ? { firstName: dto.firstName } : {}),
        ...(dto.lastName ? { lastName: dto.lastName } : {}),
        lastSeenAt: new Date(),
      },
    });
  }

  async update(companyId: string, id: string, dto: Partial<CreateContactDto>) {
    await this.get(companyId, id); // throws if not found
    return prisma.contact.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { ...(dto as any), updatedAt: new Date() },
    });
  }

  async softDelete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.contact.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async optOut(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.contact.update({
      where: { id },
      data: { optedOut: true, optedOutAt: new Date() },
    });
  }

  /** Called automatically when WhatsApp service receives a message from an unknown number. */
  async findOrCreate(companyId: string, phoneNumber: string, displayName?: string) {
    return this.create(companyId, { phoneNumber, displayName });
  }
}
