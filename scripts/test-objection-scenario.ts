import 'dotenv/config';
import { db } from '@shared/lib/db/db.js';
import { leads, users } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import {
  processObjection,
  recordTacticSent,
  getLeadObjectionState,
  classifyObjectionFromText,
  estimateObjectionIntensity,
  findMatchingCustomObjection
} from '@shared/lib/intelligence/objection-state-machine.js';

async function runTest() {
  console.log('🧪 Starting Multi-Objection State Machine Test...');

  // 1. Create mock user
  const [user] = await db.insert(users).values({
    email: `test-osm-${Date.now()}@example.com`,
    password: 'mockpassword',
    company: 'OSM Test Inc',
  }).returning();

  // 2. Create mock lead
  const [lead] = await db.insert(leads).values({
    userId: user.id,
    name: 'Objection Tester',
    channel: 'email',
    status: 'new',
    metadata: {}
  }).returning();

  console.log(`✅ Created mock user (${user.id}) and lead (${lead.id})`);

  const businessContext = {
    businessName: 'Audnix AI',
    coreOffer: 'autonomous SDR services',
    userIndustry: 'AI SDR Automation',
    leadNiche: 'SaaS companies'
  };

  // --- OBJECTION 1: Timing ---
  const msg1 = "I am too busy right now, come back next month.";
  console.log(`\n📥 Objection 1: "${msg1}"`);
  
  const class1 = classifyObjectionFromText(msg1);
  const intensity1 = estimateObjectionIntensity(msg1);
  console.log(`   Detected Category: ${class1.category} (conf: ${class1.confidence.toFixed(2)}), Intensity: ${intensity1}`);
  
  if (class1.category !== 'timing') {
    throw new Error(`Expected timing category, got ${class1.category}`);
  }

  const decision1 = await processObjection({
    leadId: lead.id,
    userId: user.id,
    leadName: lead.name || 'Tester',
    objectionText: msg1,
    category: class1.category,
    hiddenObjection: 'Timing block: busy right now',
    intensity: intensity1,
    businessContext
  });

  console.log(`   Selected Tactic: ${decision1.nextTactic}`);
  console.log(`   Escalation Level: ${decision1.state.escalationLevel}`);
  console.log(`   Should Flag For Human: ${decision1.shouldFlagForHuman}`);
  
  // Verify that prompt template interpolation actually worked
  console.log(`   Prompt snippet check (timing/reframe/urgency):`);
  console.log(`     Contains businessName: ${decision1.systemPromptBlock.includes('Audnix AI')}`);
  console.log(`     Contains leadNiche: ${decision1.systemPromptBlock.includes('SaaS companies')}`);
  if (!decision1.systemPromptBlock.includes('Audnix AI') || !decision1.systemPromptBlock.includes('SaaS companies')) {
    throw new Error('System prompt block businessContext interpolation failed');
  }

  await recordTacticSent(lead.id, user.id, `Sent ${decision1.nextTactic} tactic response`);
  console.log(`✅ Tactic recorded.`);

  // --- OBJECTION 2: Price ---
  const msg2 = "Actually it is way too expensive, we have no budget for this.";
  console.log(`\n📥 Objection 2: "${msg2}"`);

  const class2 = classifyObjectionFromText(msg2);
  const intensity2 = estimateObjectionIntensity(msg2);
  console.log(`   Detected Category: ${class2.category} (conf: ${class2.confidence.toFixed(2)}), Intensity: ${intensity2}`);

  if (class2.category !== 'price') {
    throw new Error(`Expected price category, got ${class2.category}`);
  }

  const decision2 = await processObjection({
    leadId: lead.id,
    userId: user.id,
    leadName: lead.name || 'Tester',
    objectionText: msg2,
    category: class2.category,
    hiddenObjection: 'Budget limit / ROI concern',
    intensity: intensity2,
    businessContext
  });

  console.log(`   Selected Tactic: ${decision2.nextTactic}`);
  console.log(`   Escalation Level: ${decision2.state.escalationLevel}`);
  console.log(`   Lead Profile Classified: ${decision2.state.profileType} (conf: ${decision2.state.profileConfidence.toFixed(2)})`);
  console.log(`   Previous Objection Outcome: ${decision2.state.history[0].outcome}`);

  if (decision2.state.history[0].outcome !== 'objected_again') {
    throw new Error(`Expected previous outcome to be 'objected_again', got ${decision2.state.history[0].outcome}`);
  }

  await recordTacticSent(lead.id, user.id, `Sent ${decision2.nextTactic} tactic response`);
  console.log(`✅ Tactic recorded.`);

  // --- OBJECTION 3: Trust ---
  const msg3 = "I don't think this actually works, sounds too good to be true.";
  console.log(`\n📥 Objection 3: "${msg3}"`);

  const class3 = classifyObjectionFromText(msg3);
  const intensity3 = estimateObjectionIntensity(msg3);
  console.log(`   Detected Category: ${class3.category} (conf: ${class3.confidence.toFixed(2)}), Intensity: ${intensity3}`);

  const decision3 = await processObjection({
    leadId: lead.id,
    userId: user.id,
    leadName: lead.name || 'Tester',
    objectionText: msg3,
    category: class3.category,
    hiddenObjection: 'Trust issue / risk aversion',
    intensity: intensity3,
    businessContext
  });

  console.log(`   Selected Tactic: ${decision3.nextTactic}`);
  console.log(`   Escalation Level: ${decision3.state.escalationLevel}`);
  console.log(`   Lead Profile Classified: ${decision3.state.profileType}`);

  await recordTacticSent(lead.id, user.id, `Sent ${decision3.nextTactic} tactic response`);
  console.log(`✅ Tactic recorded.`);

  // --- OBJECTION 4: Competitor ---
  const msg4 = "We already use Apollo and it works fine.";
  console.log(`\n📥 Objection 4: "${msg4}"`);

  const class4 = classifyObjectionFromText(msg4);
  const intensity4 = estimateObjectionIntensity(msg4);
  console.log(`   Detected Category: ${class4.category} (conf: ${class4.confidence.toFixed(2)}), Intensity: ${intensity4}`);

  const decision4 = await processObjection({
    leadId: lead.id,
    userId: user.id,
    leadName: lead.name || 'Tester',
    objectionText: msg4,
    category: class4.category,
    hiddenObjection: 'Competitor lock-in',
    intensity: intensity4,
    businessContext
  });

  console.log(`   Selected Tactic: ${decision4.nextTactic}`);
  console.log(`   Escalation Level: ${decision4.state.escalationLevel}`);
  console.log(`   Lead Profile Classified: ${decision4.state.profileType}`);
  console.log(`   Should Flag For Human: ${decision4.shouldFlagForHuman}`);

  await recordTacticSent(lead.id, user.id, `Sent ${decision4.nextTactic} tactic response`);
  console.log(`✅ Tactic recorded.`);

  // --- OBJECTION 5: Fit (Escalation Level 4) ---
  const msg5 = "This does not apply to our industry.";
  console.log(`\n📥 Objection 5: "${msg5}"`);

  const class5 = classifyObjectionFromText(msg5);
  const intensity5 = estimateObjectionIntensity(msg5);
  console.log(`   Detected Category: ${class5.category} (conf: ${class5.confidence.toFixed(2)}), Intensity: ${intensity5}`);

  const decision5 = await processObjection({
    leadId: lead.id,
    userId: user.id,
    leadName: lead.name || 'Tester',
    objectionText: msg5,
    category: class5.category,
    hiddenObjection: 'Product/market fit skepticism',
    intensity: intensity5,
    businessContext
  });

  console.log(`   Selected Tactic: ${decision5.nextTactic}`);
  console.log(`   Escalation Level: ${decision5.state.escalationLevel}`);
  console.log(`   Lead Profile Classified: ${decision5.state.profileType}`);
  console.log(`   Should Flag For Human: ${decision5.shouldFlagForHuman}`);

  if (!decision5.shouldFlagForHuman) {
    throw new Error('Expected lead to be flagged for human review after 5 objections');
  }

  await recordTacticSent(lead.id, user.id, `Sent final push response`);

  // Verify DB state
  const finalState = await getLeadObjectionState(lead.id);
  console.log('\n📊 Final Lead Objection State from DB:');
  console.log(`- Total Objections: ${finalState.totalObjections}`);
  console.log(`- Escalation Level: ${finalState.escalationLevel}`);
  console.log(`- Profile Type: ${finalState.profileType}`);
  console.log(`- Flagged for Human: ${finalState.flaggedForHumanReview}`);
  console.log(`- Reason: ${finalState.humanReviewReason}`);

  // --- TEST USER-DEFINED CUSTOM OBJECTION MATCHING ---
  console.log('\n🧪 Testing custom objection matching logic...');
  const mockCustomObjections = [
    {
      id: '1',
      objection: 'out of budget',
      category: 'price' as any,
      response: 'Offer the 2-week pilot instead of discount'
    },
    {
      id: '2',
      objection: 'send more info',
      category: 'general' as any,
      response: 'Send the brand 1-pager link'
    }
  ];

  const testMatch1 = findMatchingCustomObjection('I like it but it is out of budget for us.', mockCustomObjections);
  console.log(`   Text: "out of budget" -> Match found: ${testMatch1 ? 'YES' : 'NO'} (${testMatch1?.response})`);
  if (!testMatch1 || testMatch1.id !== '1') {
    throw new Error('Custom objection keyword matching failed');
  }

  const testMatch2 = findMatchingCustomObjection('Can you send more info first?', mockCustomObjections);
  console.log(`   Text: "send more info" -> Match found: ${testMatch2 ? 'YES' : 'NO'} (${testMatch2?.response})`);
  if (!testMatch2 || testMatch2.id !== '2') {
    throw new Error('Custom objection substring matching failed');
  }

  // Cleanup
  console.log('\n🧹 Cleaning up test data...');
  await db.delete(leads).where(eq(leads.id, lead.id));
  await db.delete(users).where(eq(users.id, user.id));

  console.log('\n🎉 ALL MULTI-OBJECTION STATE MACHINE TESTS PASSED!');
  process.exit(0);
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
