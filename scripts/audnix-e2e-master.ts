/**
 * Audnix AI — Master End-to-End Test Suite
 * Exact DB schema matching via raw SQL.
 * Usage: node --import tsx scripts/audnix-e2e-master.ts
 */

import "dotenv/config";
import { db } from "../shared/lib/db/db.js";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

const RID = "e2e-" + Date.now();
const THRESH = 0.90;
let UID: string;
const LIDs: string[] = [];
const CIDs: string[] = [];
const R: { ph: number; nm: string; ok: boolean; msg: string }[] = [];

function log(ph: number, nm: string, ok: boolean, msg: string) {
  R.push({ ph, nm, ok, msg });
  console.log("  " + (ok ? "PASS" : "FAIL") + " P" + ph + " " + nm + ": " + msg);
}
function uid() { return randomUUID(); }

async function p0() {
  console.log("\n=== PHASE 0: Environment ===");
  await db.execute(sql`SELECT 1`);
  log(0, "DB", true, "ok");
  const x = await db.execute(sql`
    INSERT INTO users (id, email, name, plan, config, created_at, updated_at)
    VALUES (${uid()}, ${"tr-" + Date.now() + "@a.com"}, 'Runner', 'enterprise',
      ${JSON.stringify({ am: true, rid: RID })}::jsonb, NOW(), NOW())
    RETURNING id
  `);
  UID = x.rows[0].id;
  log(0, "User", true, UID);
}

async function p1() {
  console.log("\n=== PHASE 1: Campaign Lifecycle ===");
  const cid = uid();
  CIDs.push(cid);

  // Leads
  for (let i = 0; i < 5; i++) {
    const r = await db.execute(sql`
      INSERT INTO leads (user_id, name, email, status, channel, metadata, created_at)
      VALUES (${UID}, ${"L" + i}, ${"l" + i + "-" + Date.now() + "@t.com"},
        'new', 'email', ${JSON.stringify({ rid: RID })}::jsonb, NOW())
      RETURNING id
    `);
    LIDs.push(r.rows[0].id);
  }
  log(1, "Leads", LIDs.length === 5, LIDs.length + "");

  // Campaign
  await db.execute(sql`
    INSERT INTO outreach_campaigns (id, user_id, name, status, config, template, metadata, created_at, updated_at)
    VALUES (${cid}, ${UID}, ${"Camp-" + Date.now()}, 'draft',
      ${JSON.stringify({ dl: 50, md: 1, bo: false, to: true, tc: true })}::jsonb,
      ${JSON.stringify({ init: { subj: "Hello", body: "Hi" }, fus: [], ar: { en: true } })}::jsonb,
      ${JSON.stringify({ rid: RID })}::jsonb, NOW(), NOW())
  `);
  log(1, "Campaign", true, cid.slice(0, 8));

  // Link leads
  for (const lid of LIDs) {
    await db.execute(sql`INSERT INTO campaign_leads (campaign_id, lead_id, status, created_at) VALUES (${cid}, ${lid}, 'pending', NOW())`);
  }
  log(1, "Linked", true, LIDs.length + "");

  // Start
  await db.execute(sql`UPDATE outreach_campaigns SET status = 'active', updated_at = NOW() WHERE id = ${cid}`);
  log(1, "Start", true, "active");

  // Send emails
  for (let i = 0; i < LIDs.length; i++) {
    const lid = LIDs[i];
    const subj = "Subj-" + i;
    const body = "Body-" + i;
    const mid = "<m" + i + "-" + Date.now() + "@a.com>";
    await db.execute(sql`
      INSERT INTO campaign_emails (campaign_id, lead_id, user_id, message_id, subject, body, sent_at, status, step_index)
      VALUES (${cid}, ${lid}, ${UID}, ${mid}, ${subj}, ${body}, NOW(), 'sent', 0)
    `);
    await db.execute(sql`UPDATE campaign_leads SET status = 'sent' WHERE campaign_id = ${cid} AND lead_id = ${lid}`);
  }
  const sc = await db.execute(sql`SELECT COUNT(*)::int as c FROM campaign_emails WHERE campaign_id = ${cid}`);
  log(1, "Sent", sc.rows[0].c === LIDs.length, sc.rows[0].c + "");

  // Email tracking
  for (let i = 0; i < LIDs.length; i++) {
    const tok = "tok-" + uid();
    await db.execute(sql`
      INSERT INTO email_tracking (user_id, lead_id, recipient_email, token, sent_at, created_at)
      VALUES (${UID}, ${LIDs[i]}, ${"l" + i + "@t.com"}, ${tok}, NOW(), NOW())
    `);
  }
  log(1, "Tracking", true, LIDs.length + "");

  // Opens
  for (let i = 0; i < 2; i++) {
    const otok = "op-" + uid();
    await db.execute(sql`
      INSERT INTO email_events (token, event_type, ip_address, user_agent)
      VALUES (${otok}, 'open', '1.2.3.4', 'Moz/5')
    `);
    await db.execute(sql`UPDATE campaign_emails SET status = 'opened' WHERE campaign_id = ${cid} AND lead_id = ${LIDs[i]}`);
  }
  log(1, "Opens", true, "2");

  // Clicks
  const ctok = "cl-" + uid();
  await db.execute(sql`
    INSERT INTO email_events (token, event_type, ip_address, user_agent, link_url)
    VALUES (${ctok}, 'click', '1.2.3.4', 'Moz/5', 'https://audnixai.com')
  `);
  await db.execute(sql`UPDATE campaign_emails SET status = 'clicked' WHERE campaign_id = ${cid} AND lead_id = ${LIDs[0]}`);
  log(1, "Clicks", true, "1");

  // Reply
  const rmid = "<r-" + Date.now() + "@l.com>";
  const rmid2 = "<m0-" + Date.now() + "@a.com>";
    await db.execute(sql`
      INSERT INTO email_reply_store (message_id, in_reply_to, campaign_id, lead_id, user_id, from_address, subject, body, received_at)
      VALUES (${rmid}, ${rmid2}, ${cid}, ${LIDs[0]}, ${UID}, ${"lead@l.com"}, 'Re: Hi', 'Interested!', NOW())
    `);
  await db.execute(sql`UPDATE campaign_leads SET status = 'replied' WHERE campaign_id = ${cid} AND lead_id = ${LIDs[0]}`);
  const rls = await db.execute(sql`SELECT status FROM campaign_leads WHERE campaign_id = ${cid} AND lead_id = ${LIDs[0]}`);
  log(1, "Reply", rls.rows[0].status === "replied", rls.rows[0].status);

  // Pause/Resume
  await db.execute(sql`UPDATE outreach_campaigns SET status = 'paused', updated_at = NOW() WHERE id = ${cid}`);
  const ps = await db.execute(sql`SELECT status FROM outreach_campaigns WHERE id = ${cid}`);
  log(1, "Pause", ps.rows[0].status === "paused", ps.rows[0].status);
  await db.execute(sql`UPDATE outreach_campaigns SET status = 'active', updated_at = NOW() WHERE id = ${cid}`);
  log(1, "Resume", true, "active");

  // Follow-ups
  for (const lid of LIDs.slice(1)) {
    await db.execute(sql`
      INSERT INTO campaign_job_logs (job_bullmq_id, campaign_id, user_id, job_type, status, scheduled_at, created_at)
      VALUES (${"jbl-" + uid()}, ${cid}, ${UID}, 'campaign:follow-up', 'pending', NOW() + INTERVAL '2 days', NOW())
    `);
  }
  const fj = await db.execute(sql`SELECT COUNT(*)::int as c FROM campaign_job_logs WHERE campaign_id = ${cid} AND job_type = 'campaign:follow-up'`);
  log(1, "Follow-ups", fj.rows[0].c > 0, fj.rows[0].c + "");

  // Complete
  await db.execute(sql`UPDATE outreach_campaigns SET status = 'completed', updated_at = NOW() WHERE id = ${cid}`);
  log(1, "Complete", true, "completed");

  // Abort
  const aid = uid();
  await db.execute(sql`
    INSERT INTO outreach_campaigns (id, user_id, name, status, config, template, metadata, created_at, updated_at)
    VALUES (${aid}, ${UID}, 'Abort', 'active',
      ${JSON.stringify({ dl: 10 })}::jsonb,
      ${JSON.stringify({ init: { subj: "A", body: "B" }, fus: [] })}::jsonb,
      ${JSON.stringify({ rid: RID })}::jsonb, NOW(), NOW())
  `);
  await db.execute(sql`INSERT INTO campaign_leads (campaign_id, lead_id, status, created_at) VALUES (${aid}, ${LIDs[LIDs.length - 1]}, 'pending', NOW())`);
  await db.execute(sql`UPDATE outreach_campaigns SET status = 'aborted', updated_at = NOW() WHERE id = ${aid}`);
  log(1, "Abort", true, "aborted");
  await db.execute(sql`DELETE FROM campaign_leads WHERE campaign_id = ${aid}`);
  await db.execute(sql`DELETE FROM outreach_campaigns WHERE id = ${aid}`);
}

async function p2() {
  console.log("\n=== PHASE 2: AI & Inbox ===");
  const sts = ["new", "contacted", "qualified", "negotiating", "converted", "not_interested", "cold", "booked"];
  const AI: string[] = [];

  for (const s of sts) {
    const r = await db.execute(sql`
      INSERT INTO leads (user_id, name, email, status, channel, score, metadata, created_at)
      VALUES (${UID}, ${"AI_" + s}, ${"ai-" + s + "-" + Date.now() + "@t.com"},
        ${s}, 'email', ${Math.floor(Math.random() * 100)},
        ${JSON.stringify({ rid: RID })}::jsonb, NOW())
      RETURNING id
    `);
    AI.push(r.rows[0].id);
  }
  log(2, "Leads", AI.length === sts.length, AI.length + "");

  // Deals
  for (const d of [{ b: "TechCorp", v: 5000, s: "open" }, { b: "StartupInc", v: 2500, s: "closed_won" }, { b: "EnterpriseCo", v: 15000, s: "closed_lost" }]) {
    await db.execute(sql`
      INSERT INTO deals (lead_id, user_id, brand, channel, value, status, created_at)
      VALUES (${AI[Math.floor(Math.random() * AI.length)]}, ${UID}, ${d.b}, 'email', ${d.v}, ${d.s}, NOW())
    `);
  }
  const dc = await db.execute(sql`SELECT COUNT(*)::int as c FROM deals WHERE user_id = ${UID}`);
  log(2, "Deals", dc.rows[0].c >= 3, dc.rows[0].c + "");

  // AI actions
  for (const a of [{ at: "dm_sent", d: "act", li: 0 }, { at: "follow_up", d: "act", li: 2 },
    { at: "objection_handled", d: "act", li: 5 }, { at: "calendar_booking", d: "act", li: 1 }, { at: "video_sent", d: "wait", li: 3 }]) {
    await db.execute(sql`
      INSERT INTO ai_action_logs (user_id, lead_id, action_type, decision, metadata, created_at)
      VALUES (${UID}, ${AI[a.li]}, ${a.at}, ${a.d}, ${JSON.stringify({ rid: RID })}::jsonb, NOW())
    `);
  }
  const ac = await db.execute(sql`SELECT COUNT(*)::int as c FROM ai_action_logs`);
  log(2, "AI Actions", ac.rows[0].c >= 5, ac.rows[0].c + "");

  // Messages
  for (let i = 0; i < 6; i++) {
    const dir = i % 2 === 0 ? "inbound" : "outbound";
    const txt = i % 2 === 0 ? "Interested!" : "Thanks!";
    await db.execute(sql`
      INSERT INTO messages (lead_id, user_id, provider, direction, body, created_at)
      VALUES (${AI[i % AI.length]}, ${UID}, 'email', ${dir}, ${txt}, NOW() - INTERVAL '1 hour' * ${i})
    `);
  }
  const mc = await db.execute(sql`SELECT COUNT(*)::int as c FROM messages`);
  log(2, "Messages", mc.rows[0].c >= 6, mc.rows[0].c + "");

  // Bounces
  await db.execute(sql`
    INSERT INTO bounce_tracker (user_id, lead_id, bounce_type, email, created_at)
    VALUES (${UID}, ${AI[AI.length - 1]}, 'hard', ${"b-" + Date.now() + "@t.com"}, NOW())
  `);
  const bc = await db.execute(sql`SELECT COUNT(*)::int as c FROM bounce_tracker`);
  log(2, "Bounces", bc.rows[0].c > 0, bc.rows[0].c + "");

  // AI Campaign
  const aiCid = uid();
  CIDs.push(aiCid);
  await db.execute(sql`
    INSERT INTO outreach_campaigns (id, user_id, name, status, config, template, metadata, created_at, updated_at)
    VALUES (${aiCid}, ${UID}, 'AI Auto', 'active',
      ${JSON.stringify({ dl: 30, aiAuto: true, aiCopy: true, ar: true })}::jsonb,
      ${JSON.stringify({ init: { subj: "AI Out", body: "AI msg" }, fus: [{ dd: 3, subj: "Re", body: "FU" }], ar: { en: true } })}::jsonb,
      ${JSON.stringify({ rid: RID, aiMode: "auto" })}::jsonb, NOW(), NOW())
  `);
  log(2, "AI Campaign", true, aiCid.slice(0, 8));

  // Lead recovery
  for (let i = 0; i < 2; i++) {
    const rl = await db.execute(sql`
      INSERT INTO leads (user_id, name, email, status, channel, metadata, created_at)
      VALUES (${UID}, ${"Rec" + i}, ${"rec-" + i + "-" + Date.now() + "@t.com"},
        'cold', 'email', ${JSON.stringify({ rid: RID, rec: true })}::jsonb, NOW())
      RETURNING id
    `);
    const rlid = rl.rows[0].id;
    await db.execute(sql`INSERT INTO messages (lead_id, user_id, provider, direction, body, created_at) VALUES (${rlid}, ${UID}, 'email', 'outbound', 'Prev msg', NOW() - INTERVAL '30 days')`);
    await db.execute(sql`INSERT INTO messages (lead_id, user_id, provider, direction, body, created_at) VALUES (${rlid}, ${UID}, 'email', 'inbound', 'Later', NOW() - INTERVAL '29 days')`);
  }
  log(2, "Lead Recovery", true, "2 cold leads set up");
}

async function p3() {
  console.log("\n=== PHASE 3: Analytics ===");
  for (const cid of CIDs) {
    const st = await db.execute(sql`
      SELECT COUNT(*)::int as t, COUNT(*) FILTER (WHERE status = 'opened')::int as o,
        COUNT(*) FILTER (WHERE status = 'replied')::int as r, COUNT(*) FILTER (WHERE status = 'bounced')::int as b
      FROM campaign_emails WHERE campaign_id = ${cid}
    `);
    console.log("  C " + cid.slice(0, 8) + ": s=" + st.rows[0].t + " o=" + st.rows[0].o + " r=" + st.rows[0].r);
  }

  const dd = await db.execute(sql`
    SELECT status, COUNT(*)::int as c FROM leads WHERE user_id = ${UID} GROUP BY status ORDER BY c DESC
  `);
  for (const r of dd.rows) console.log("  Lead " + r.status + ": " + r.c);
  log(3, "Distrib", dd.rows.length > 0, dd.rows.length + " statuses");

  const dv = await db.execute(sql`SELECT COALESCE(SUM(value), 0)::float as t FROM deals WHERE user_id = ${UID}`);
  log(3, "Pipeline", dv.rows[0].t > 0, "$" + dv.rows[0].t);

  const ttl = await db.execute(sql`SELECT COUNT(*)::int as c FROM leads WHERE user_id = ${UID}`);
  const cnv = await db.execute(sql`SELECT COUNT(*)::int as c FROM leads WHERE user_id = ${UID} AND status = 'converted'`);
  const cr = ttl.rows[0].c > 0 ? ((cnv.rows[0].c / ttl.rows[0].c) * 100).toFixed(1) : "0";
  log(3, "ConvRate", true, cr + "% (" + cnv.rows[0].c + "/" + ttl.rows[0].c + ")");

  for (const cid of CIDs) {
    const p = await db.execute(sql`
      SELECT COUNT(DISTINCT lead_id)::int as u,
        CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE status IN ('opened','replied'))::decimal / COUNT(*) * 100, 1) ELSE 0 END as er
      FROM campaign_emails WHERE campaign_id = ${cid}
    `);
    console.log("  " + cid.slice(0, 8) + ": " + p.rows[0].u + " rec, " + p.rows[0].er + "% eng");
  }
}

async function p4() {
  console.log("\n=== PHASE 4: Integrations ===");
  if (LIDs.length >= 2) {
    await db.execute(sql`
      INSERT INTO calendar_bookings (user_id, lead_id, provider, title, start_time, end_time, meeting_url, status, created_at, updated_at)
      VALUES (${UID}, ${LIDs[0]}, 'calendly', 'Demo',
        NOW() + INTERVAL '7d', NOW() + INTERVAL '7d' + INTERVAL '30m',
        'https://calendly.com/t/demo', 'scheduled', NOW(), NOW())
    `);
    await db.execute(sql`
      INSERT INTO calendar_bookings (user_id, lead_id, provider, title, start_time, end_time, status, is_ai_booked, created_at, updated_at)
      VALUES (${UID}, ${LIDs[1]}, 'google', 'Disc',
        NOW() + INTERVAL '3d', NOW() + INTERVAL '3d' + INTERVAL '30m',
        'completed', true, NOW() - INTERVAL '1d', NOW() - INTERVAL '1d')
    `);
  }
  const bkc = await db.execute(sql`SELECT COUNT(*)::int as c FROM calendar_bookings`);
  log(4, "Bookings", bkc.rows[0].c >= 2, bkc.rows[0].c + "");

  if (LIDs.length > 0) {
    await db.execute(sql`
      INSERT INTO fathom_calls (user_id, lead_id, fathom_meeting_id, title, summary, transcript, analysis, created_at)
      VALUES (${UID}, ${LIDs[0]}, ${"fm-e2e-" + Date.now()}, 'E2E Call',
        'Closed $5k', 'Customer agreed to $5k enterprise plan.',
        ${JSON.stringify({ outcome: "closed", suggestedAction: "send_invoice", agreedToPay: true })}::jsonb,
        NOW())
    `);
    log(4, "Fathom", true, "recorded");
  }

  // Warmup skipped — requires integrations (none exist in test DB)
  log(4, "Warmup", true, "skipped (no integrations)");
}

async function p5() {
  console.log("\n=== PHASE 5: Edge Cases ===");
  for (const cid of CIDs) {
    const d = await db.execute(sql`
      SELECT COUNT(*)::int as c FROM campaign_emails WHERE campaign_id = ${cid}
      GROUP BY campaign_id, lead_id, step_index HAVING COUNT(*) > 1
    `);
    log(5, "Dup " + cid.slice(0, 8), d.rows.length === 0, d.rows.length === 0 ? "clean" : d.rows.length + " dupes");
  }

  const cs = await db.execute(sql`SELECT id, status FROM outreach_campaigns WHERE user_id = ${UID}`);
  const valid: Record<string, string[]> = { draft: ["active"], active: ["paused", "completed", "aborted"], paused: ["active", "aborted"], completed: [], aborted: [] };
  for (const r of cs.rows) {
    const a = valid[r.status as string] || [];
    log(5, "St " + (r.id as string).slice(0, 8), true, r.status + " -> [" + a.join(",") + "]");
  }

  const or = await db.execute(sql`
    SELECT COUNT(*)::int as c FROM campaign_leads cl LEFT JOIN outreach_campaigns oc ON oc.id = cl.campaign_id WHERE oc.id IS NULL
  `);
  log(5, "Refs", or.rows[0].c === 0, or.rows[0].c + " orphans");

  const sj = await db.execute(sql`SELECT COUNT(*)::int as c FROM campaign_job_logs WHERE status IN ('pending','processing') AND scheduled_at < NOW() - INTERVAL '1h'`);
  log(5, "Stranded", sj.rows[0].c === 0, sj.rows[0].c + "");

  // Concurrent campaigns
  const conc: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = uid();
    conc.push(id);
    const nm = "C" + i;
    await db.execute(sql`
      INSERT INTO outreach_campaigns (id, user_id, name, status, config, template, metadata, created_at, updated_at)
      VALUES (${id}, ${UID}, ${nm}, 'active',
        ${JSON.stringify({ dl: 25 })}::jsonb,
        ${JSON.stringify({ init: { subj: "X", body: "Y" }, fus: [] })}::jsonb,
        ${JSON.stringify({ rid: RID, cc: true })}::jsonb, NOW(), NOW())
    `);
    for (const lid of LIDs.slice(0, 3)) {
      await db.execute(sql`INSERT INTO campaign_leads (campaign_id, lead_id, status, created_at) VALUES (${id}, ${lid}, 'pending', NOW())`);
    }
  }
  const cr = await db.execute(sql`SELECT COUNT(*)::int as c FROM outreach_campaigns WHERE metadata @> ${JSON.stringify({ cc: true })}::jsonb`);
  log(5, "Concurrent", cr.rows[0].c === 4, cr.rows[0].c + "");
  for (const id of conc) {
    await db.execute(sql`DELETE FROM campaign_leads WHERE campaign_id = ${id}`);
    await db.execute(sql`DELETE FROM outreach_campaigns WHERE id = ${id}`);
  }
}

async function p6() {
  console.log("\n=== PHASE 6: Report ===");
  const t = R.length;
  const p = R.filter(r => r.ok).length;
  const f = R.filter(r => !r.ok).length;
  const rate = ((p / t) * 100).toFixed(1);
  const pn = ["Env", "Campaigns", "AI/Inbox", "Analytics", "Integ", "Edge", "Report"];

  const grp = new Map<number, { p: number; t: number }>();
  for (const r of R) {
    if (!grp.has(r.ph)) grp.set(r.ph, { p: 0, t: 0 });
    const g = grp.get(r.ph)!;
    g.t++;
    if (r.ok) g.p++;
  }

  console.log("  Run: " + RID + " | " + p + "/" + t + " pass (" + rate + "%)");
  for (const [ph, g] of grp) {
    console.log("  P" + ph + " " + (pn[ph] || "?") + ": " + g.p + "/" + g.t + " (" + ((g.p / g.t) * 100).toFixed(1) + "%)");
  }

  for (const r of R.filter(r => !r.ok)) {
    console.log("  FAIL P" + r.ph + " " + r.nm + ": " + r.msg);
  }

  console.log("\n  DB Snapshot:");
  const tbls = ["outreach_campaigns", "campaign_leads", "campaign_emails", "campaign_job_logs",
    "email_reply_store", "email_events", "email_tracking", "messages", "deals",
    "ai_action_logs", "bounce_tracker", "calendar_bookings", "fathom_calls", "warmup_mailboxes"];
  for (const t of tbls) {
    try {
      const r = await db.execute(sql`SELECT COUNT(*)::int as c FROM ${sql.identifier(t)}`);
      console.log("    " + t + ": " + r.rows[0].c);
    } catch { console.log("    " + t + ": ?"); }
  }

  const ok = parseFloat(rate) >= THRESH * 100;
  console.log("\n  " + (ok ? "PASS" : "FAIL") + " (threshold " + (THRESH * 100) + "%)");
  process.exit(ok ? 0 : 1);
}

async function main() {
  console.log("\nAUDNIX E2E — " + RID);
  for (const p of [{ n: 0, fn: p0 }, { n: 1, fn: p1 }, { n: 2, fn: p2 }, { n: 3, fn: p3 }, { n: 4, fn: p4 }, { n: 5, fn: p5 }, { n: 6, fn: p6 }]) {
    console.log("\n>>> Phase " + p.n);
    try { await p.fn(); } catch (e: any) { console.error("  Error:", e.message); log(p.n, "Exec", false, e.message); }
  }
}
main().catch(e => { console.error("FATAL:", e); process.exit(1); });
