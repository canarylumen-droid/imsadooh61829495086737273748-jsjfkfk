import { db } from '../shared/lib/db/db.js';

try {
  const result = await db.execute(`
    SELECT id, name, status, created_at, 
           (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = oc.id) as total_leads,
           (SELECT COUNT(*) FROM campaign_emails ce WHERE ce.campaign_id = oc.id) as emails_sent,
           (SELECT COUNT(*) FROM campaign_emails ce WHERE ce.campaign_id = oc.id AND ce.status = 'opened') as opens,
           (SELECT COUNT(*) FROM campaign_emails ce WHERE ce.campaign_id = oc.id AND ce.status = 'replied') as replies,
           (SELECT COUNT(*) FROM campaign_emails ce WHERE ce.campaign_id = oc.id AND ce.status = 'bounced') as bounces
    FROM outreach_campaigns oc 
    WHERE oc.status != 'completed' 
    ORDER BY oc.created_at DESC 
    LIMIT 10
  `);
  console.log(JSON.stringify(result.rows, null, 2));
} catch(e) {
  console.error('Error:', e.message, e.stack);
}
process.exit(0);
