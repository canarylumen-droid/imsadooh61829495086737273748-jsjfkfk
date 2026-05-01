import 'dotenv/config';
import { storage } from '@shared/lib/storage/storage.js';
import bcrypt from 'bcryptjs';

async function seedUsers() {
    console.log('🌱 Seeding VIP users...');

    const vipUsers = [
        {
            email: 'team.replyflow@gmail.com',
            username: 'replyflow_team',
            password: 'StrongPassword123!', // They should reset this, or we set a known initial one
            plan: 'enterprise',
            subscriptionTier: 'enterprise'
        },
        {
            email: 'fortuneuchendu708@gmail.com',
            username: 'fortune_vip',
            password: 'StrongPassword123!',
            plan: 'enterprise',
            subscriptionTier: 'enterprise'
        }
    ];

    for (const vip of vipUsers) {
        try {
            const existing = await storage.getUserByEmail(vip.email);
            if (existing) {
                console.log(`ℹ️ User ${vip.email} exists. Updating plan...`);
                await storage.updateUser(existing.id, {
                    plan: 'enterprise',
                    subscriptionTier: 'enterprise'
                });
            } else {
                console.log(`✨ Creating VIP user ${vip.email}...`);
                const hashedPassword = await bcrypt.hash(vip.password, 10);
                await storage.createUser({
                    email: vip.email,
                    username: vip.username,
                    password: hashedPassword,
                    plan: 'enterprise',
                    subscriptionTier: 'enterprise',
                    role: 'admin' // Granting admin role for VIPs for now, or just member
                });
            }
        } catch (error) {
            console.error(`❌ Failed to seed ${vip.email}:`, error);
        }
    }

    console.log('✅ VIP User seeding complete.');
    process.exit(0);
}

seedUsers();
