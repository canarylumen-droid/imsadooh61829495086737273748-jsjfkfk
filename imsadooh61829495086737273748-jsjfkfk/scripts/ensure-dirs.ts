import fs from 'fs';
import path from 'path';

const dirs = [
    'uploads',
    'public/uploads',
    'public/uploads/voice',
    'public/uploads/pdf',
    'public/uploads/avatars'
];

dirs.forEach(dir => {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
    } else {
        console.log(`ℹ️ Directory already exists: ${dir}`);
    }
});
