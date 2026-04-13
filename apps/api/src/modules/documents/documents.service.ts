import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma, DocumentSignatureStatus } from '@wacrm/database';

@Injectable()
export class DocumentsService {
  async list(companyId: string, filters: { type?: string }) {
    const where: any = { companyId };
    if (filters.type) where.type = filters.type;
    return prisma.document.findMany({
      where,
      include: { signatures: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const record = await prisma.document.findFirst({
      where: { id, companyId },
      include: { signatures: true },
    });
    if (!record) throw new NotFoundException('Document not found');
    return record;
  }

  async create(companyId: string, data: { name: string; type: string; fileUrl: string; fileSize?: number; mimeType?: string; contactId?: string; dealId?: string }) {
    return prisma.document.create({
      data: { companyId, ...data },
      include: { signatures: true },
    });
  }

  async update(companyId: string, id: string, data: { name?: string; type?: string; fileUrl?: string }) {
    await this.get(companyId, id);
    return prisma.document.update({
      where: { id },
      data,
      include: { signatures: true },
    });
  }

  async delete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.document.delete({ where: { id } });
  }

  async addSignature(companyId: string, documentId: string, data: { signerName: string; signerEmail?: string }) {
    await this.get(companyId, documentId);
    return prisma.documentSignature.create({ data: { documentId, ...data } });
  }

  async updateSignature(companyId: string, documentId: string, signatureId: string, data: { status: string }) {
    await this.get(companyId, documentId);
    const signature = await prisma.documentSignature.findFirst({ where: { id: signatureId, documentId } });
    if (!signature) throw new NotFoundException('Signature not found');
    const status = data.status as DocumentSignatureStatus;
    return prisma.documentSignature.update({
      where: { id: signatureId },
      data: {
        status,
        ...(status === 'SIGNED' ? { signedAt: new Date() } : {}),
      },
    });
  }
}
