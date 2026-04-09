import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class ApiKeysService {
  async list(companyId: string, _filters: Record<string, any>) {
    return prisma.apiKey.findMany({
      where: { companyId },
      select: { id: true, name: true, prefix: true, scopes: true, isActive: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const record = await prisma.apiKey.findFirst({
      where: { id, companyId },
      select: { id: true, name: true, prefix: true, scopes: true, isActive: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    });
    if (!record) throw new NotFoundException('API key not found');
    return record;
  }

  async create(companyId: string, data: { name: string; scopes?: string[]; expiresAt?: string }) {
    const rawKey = `wacrm_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.substring(0, 12);
    const { expiresAt, ...rest } = data;

    const record = await prisma.apiKey.create({
      data: {
        companyId,
        keyHash,
        prefix,
        ...rest,
        ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
      },
    });

    return { ...record, key: rawKey };
  }

  async update(companyId: string, id: string, data: { name?: string; scopes?: string[]; isActive?: boolean }) {
    await this.get(companyId, id);
    return prisma.apiKey.update({
      where: { id },
      data,
      select: { id: true, name: true, prefix: true, scopes: true, isActive: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    });
  }

  async delete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.apiKey.delete({ where: { id } });
  }
}
