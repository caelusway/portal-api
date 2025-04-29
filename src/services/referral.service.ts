import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function generateReferralCode(): string {
  // Example: BIO-ABCD1234
  const random = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `BIO-${random}`;
}

export async function getOrCreateReferralCode(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error('Project not found');
  if (project.referralCode) return project.referralCode;

  let code: string;
  let exists = true;
  do {
    code = generateReferralCode();
    exists = !!(await prisma.project.findUnique({ where: { referralCode: code } }));
  } while (exists);

  await prisma.project.update({ where: { id: projectId }, data: { referralCode: code } });
  return code;
}

export async function useReferralCode(newProjectId: string, code: string): Promise<boolean> {
  const referrer = await prisma.project.findUnique({ where: { referralCode: code } });
  if (!referrer) return false;
  await prisma.project.update({
    where: { id: newProjectId },
    data: { referredById: referrer.id },
  });
  return true;
}

export async function getReferralStats(projectId: string) {
  const referrals = await prisma.project.findMany({ where: { referredById: projectId } });
  return {
    count: referrals.length,
    referrals: referrals.map(r => ({ id: r.id, email: r.email, projectName: r.projectName })),
  };
} 