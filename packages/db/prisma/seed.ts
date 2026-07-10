import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

await prisma.user.upsert({
  where: { email: 'demo@canopy.local' },
  create: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'demo@canopy.local',
    name: 'Canopy Demo',
    passwordHash: '$2b$12$replace.with.a.real.hash.for.production',
  },
  update: {},
});

await prisma.$disconnect();
