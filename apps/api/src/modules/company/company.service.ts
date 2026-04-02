import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';

export interface UpdateCompanyDto {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  logoUrl?: string;
  timezone?: string;
}

@Injectable()
export class CompanyService {
  async get(companyId: string) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async update(companyId: string, dto: UpdateCompanyDto) {
    await this.get(companyId);
    return prisma.company.update({ where: { id: companyId }, data: dto });
  }

  async markSetupDone(companyId: string) {
    return prisma.company.update({ where: { id: companyId }, data: { setupDone: true } });
  }

  async getSetupStatus(companyId: string) {
    const company = await this.get(companyId);
    const [aiConfig, paymentConfig, whatsappAccounts] = await Promise.all([
      prisma.aiConfig.findUnique({ where: { companyId } }),
      prisma.paymentConfig.findUnique({ where: { companyId } }),
      prisma.whatsAppAccount.findMany({ where: { companyId }, select: { id: true, status: true, phoneNumber: true } }),
    ]);

    const steps = {
      companyProfile: !!(company.name && company.email),
      whatsappConnected: whatsappAccounts.some((a) => a.status === 'CONNECTED'),
      aiConfigured: !!(aiConfig?.apiKeyEncrypted && aiConfig.autoReplyEnabled !== undefined),
      paymentConfigured: !!(paymentConfig && paymentConfig.provider !== 'NONE'),
      setupDone: company.setupDone,
    };

    return { steps, setupDone: company.setupDone, company };
  }
}
