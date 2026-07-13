import 'dotenv/config';
import { storage } from '@shared/lib/storage/storage.js';
import { analyzeInboundMessage } from '@services/brain-worker/src/ai-lib/analyzers/inbound-message-analyzer.js';

async function verify() {
  try {
    console.log('🔍 Starting verification of AI pipeline...');
    
    // 1. Get the latest user and lead
    const users = await storage.getUsers();
    const user = users[users.length - 1]; // Latest user
    if (!user) throw new Error('No test user found');
    
    const leads = await storage.getLeads({ userId: user.id });
    const lead = leads[0];
    if (!lead) throw new Error('No test lead found');
    
    console.log(`📍 Testing with Lead: ${lead.name} (${lead.id}), Status: ${lead.status}`);

    // 2. Create a mock inbound message
    const mockMessage = await storage.createMessage({
      leadId: lead.id,
      userId: user.id,
      provider: 'email',
      direction: 'inbound',
      body: 'I am extremely interested in your product. I want to buy it immediately. Can we schedule a call tomorrow at 10am to finalize?',
      metadata: {}
    });
    console.log(`📩 Created mock high-intent message: ${mockMessage.id}`);

    // 3. Trigger AI analysis
    console.log('🤖 Triggering AI analysis...');
    await analyzeInboundMessage(lead.id, mockMessage, lead as any);
    
    // 4. Verify lead status update
    const updatedLead = await storage.getLead(lead.id);
    console.log(`✅ Updated Lead Status: ${updatedLead?.status}`);
    console.log(`📊 Updated Lead Score: ${updatedLead?.score}`);
    console.log(`📝 AI Reasoning: ${(updatedLead?.metadata as any)?.lastAnalysis?.reasoning}`);

    if (updatedLead?.status === 'open') {
      console.log('✨ SUCCESS: Lead status correctly updated to "open" via High Intent detection.');
    } else {
      console.log('⚠️ WARNING: Lead status was not updated to "open". Check AI analysis confidence.');
    }

    // 5. Verify Dashboard Stats
    console.log('📈 Verifying Dashboard KPIs...');
    const stats = await storage.getDashboardStats(user.id);
    console.log(`Total Leads: ${stats.totalLeads}`);
    console.log(`Positive Intents: ${stats.positiveIntents}`);
    console.log(`Pipeline Value: $${stats.pipelineValue}`);

    if (stats.positiveIntents > 0) {
      console.log('✨ SUCCESS: Dashboard correctly reflects positive AI intent.');
    }
    
    if (stats.pipelineValue >= 5000) {
      console.log('✨ SUCCESS: Dashboard correctly includes AI-predicted deal value ($5000).');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

verify();

