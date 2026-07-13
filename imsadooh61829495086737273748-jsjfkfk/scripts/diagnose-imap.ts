import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Imap = require('imap');

const config: any = {
    user: process.env.TEST_IMAP_USER,
    password: process.env.TEST_IMAP_PASS,
    host: process.env.TEST_IMAP_HOST,
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
};

if (!config.user || !config.password || !config.host) {
    console.error('❌ Missing credentials. Set TEST_IMAP_USER, TEST_IMAP_PASS, TEST_IMAP_HOST environment variables.');
    process.exit(1);
}

const imap = new Imap(config);

function connect() {
    return new Promise<void>((resolve, reject) => {
        imap.once('ready', resolve);
        imap.once('error', reject);
        imap.connect();
    });
}

function listBoxes(): Promise<any> {
    return new Promise((resolve, reject) => {
        imap.getBoxes((err: any, boxes: any) => {
            if (err) reject(err);
            else resolve(boxes);
        });
    });
}

function append(folder: string, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
        imap.append(message, { mailbox: folder, flags: ['\\Seen'] }, (err: any) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function main() {
    try {
        console.log('🔌 Connecting to IMAP...');
        await connect();
        console.log('✅ Connected.');

        console.log('📂 Listing mailboxes...');
        const boxes = await listBoxes();

        const sentFolders: string[] = [];

        const findSent = (obj: any, prefix = '') => {
            for (const key in obj) {
                const box = obj[key];
                const fullName = prefix + key;
                if (box.attribs?.includes('\\Sent') || ['sent', 'sent items', 'sent messages'].includes(key.toLowerCase())) {
                    sentFolders.push(fullName);
                }
                if (box.children) findSent(box.children, fullName + (box.delimiter || '/'));
            }
        };
        findSent(boxes);

        if (sentFolders.length === 0) {
            console.warn('⚠️ No "Sent" folder found with attributes. Defaulting to "Sent".');
            sentFolders.push('Sent');
        } else {
            console.log('Found Sent folders:', sentFolders);
        }

        const target = sentFolders[0];
        console.log(`✉️  Appending test message to "${target}"...`);

        const message = `From: ${config.user}\r\nTo: ${config.user}\r\nSubject: Audnix IMAP Test\r\n\r\nThis is a test message to verify Sent folder sync.`;

        await append(target, message);
        console.log('✅ Test message appended successfully! Check your Sent folder.');

    } catch (error: any) {
        console.error('❌ Error:', error);
    } finally {
        imap.end();
    }
}

main();
