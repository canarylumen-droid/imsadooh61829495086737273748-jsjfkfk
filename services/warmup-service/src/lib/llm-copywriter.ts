import type { ThreadContext } from '../types/warmup-types.js';

interface ConversationScript {
  opening: string;
  replies: string[];
}

const CONVERSATIONS: ConversationScript[] = [
  {
    opening: "Hey, I saw your note about workflow automation. We've been testing a few tools lately and I'm curious what you're using for task management these days?",
    replies: [
      "Good question. We moved to ClickUp about 6 months ago. Took a while to get the team onboarded but it's been solid. What about you?",
      "ClickUp makes sense for larger teams. We went with a simpler setup — just Asana with some custom integrations. Does the job without the overhead.",
      "Yeah that's fair. The complexity is real. I think the key is picking something that sticks — tool fatigue is a bigger problem than missing features honestly.",
    ],
  },
  {
    opening: "Hi, quick question — have you looked into the new Google Workspace updates for shared drives? We're seeing some permission changes on our end and wondering if it's just us.",
    replies: [
      "Yeah we noticed that too. It rolled out last week I think. We had to re-map a few folder permissions but nothing broke. Support said it's the new security model rolling out gradually.",
      "Good to know it wasn't just us. We had a minor panic when a few external shares went read-only. Their docs are surprisingly vague about the migration timeline.",
      "Classic Google rollout. At least they give some warning now. We've learned to keep a buffer week before assuming any new feature is stable.",
    ],
  },
  {
    opening: "Just following up on our chat about API rate limits — we ended up implementing a queue-based approach with exponential backoff. Cut our timeout errors by 90%. Thought you might find that useful.",
    replies: [
      "That's timely, we've been dealing with the same issue. Are you using something like Bull for the queue or did you roll your own?",
      "We used a lightweight Redis-backed approach. Didn't want to add another dependency. Happy to share the pattern if you're interested.",
      "I'd appreciate that. We keep bouncing between different solutions. A battle-tested pattern would save us a lot of trial and error.",
    ],
  },
  {
    opening: "Hey, wanted to get your take on remote team standups. We've been doing async check-ins via Slack but I feel like we're losing some of the spontaneous collaboration. What's working for your team?",
    replies: [
      "We do a hybrid — async Loom updates in the morning, then a 15-min synchronous huddle for blockers only. Cut meeting time by 60% and people actually watch the async updates.",
      "Loom is smart. We tried that but got inconsistent participation. Switched to a shared doc model — everyone writes their update by 10am, then we only discuss what needs discussion.",
      "The doc model is underrated. We found that writing forces clearer thinking than speaking. The key is keeping it lightweight — if updates take more than 5 minutes to write, you're overdoing it.",
    ],
  },
  {
    opening: "Quick question about your email setup — are you using any deliverability monitoring tools? We've been getting inconsistent inbox placement and trying to figure out if it's our domain reputation or something else.",
    replies: [
      "We use Postmark's deliverability reports plus Google Postmaster. Caught a few issues early that way. What sender score are you seeing?",
      "Around 90-95 depending on the day. But we had a DMARC issue last month that tanked it for a week. Took forever to trace back to a misconfigured SPF record.",
      "DMARC is the one that gets people. The reporting is invaluable but interpreting it is another skill. We wrote an internal tool to parse the aggregate reports into something readable.",
    ],
  },
  {
    opening: "Hi, random question — we're evaluating some analytics platforms and I remember you mentioned using something custom. Would you recommend building vs buying for event tracking?",
    replies: [
      "Honestly depends on volume. Under 10M events/month, there are plenty of tools that work well. Above that, the cost adds up fast and custom starts making sense.",
      "We hit that exact inflection point. Went custom around 15M/month and never looked back. The flexibility is worth the engineering time if you have the bandwidth.",
      "One thing I'd add — make sure your data model is solid before building. We had to migrate schemas twice in the first year because we didn't think ahead about growth.",
    ],
  },
  {
    opening: "Hey, circling back on the authentication thing. We tried implementing passkeys and it was surprisingly smooth. Users are adopting faster than I expected. Have you looked into it?",
    replies: [
      "Not yet — been on the fence. Our user base is pretty traditional and I worry about confusion. What's the adoption rate looking like for you?",
      "About 40% in the first month. We kept passwords as a fallback so nobody gets locked out. The biometric flow on mobile is especially seamless.",
      "40% is solid for month one. We might start with a pilot group. Any resources or docs you'd recommend for the implementation?",
    ],
  },
  {
    opening: "Just a heads up — we noticed some unusual SMTP greeting delays from our provider yesterday. Took about 20 minutes to resolve. Not sure if it was regional but wanted to flag it.",
    replies: [
      "Thanks for the heads up. We didn't see anything on our end but I'll check the logs. Which region are you in?",
      "US-East. It was intermittent — some servers were fine, others were timing out. Seems stable now but we're monitoring it.",
      "We're in US-East too. Might have been a peering issue. We've been thinking about adding a secondary provider for redundancy.",
    ],
  },
  {
    opening: "Quick thought — we just switched our CI/CD to GitHub Actions from Jenkins and the developer experience is night and day. If your team is still on Jenkins, worth considering the move.",
    replies: [
      "Oh man, don't remind me. We've been meaning to migrate for over a year. The Jenkins pipeline is a nightmare of legacy plugins. How long did the migration take?",
      "About 3 weeks for full migration, but we could have done it in 2. Most of the time was porting complex pipeline logic. The simple stuff moved in days.",
      "That's not bad. We have about 40 repos so I've been dreading it. Might dedicate a sprint to it after the current release cycle.",
    ],
  },
  {
    opening: "Hey, question about your documentation workflow — we're using Notion but it's getting unwieldy as we scale. Thinking about moving to a proper docs platform. What are you using?",
    replies: [
      "We migrated from Notion to GitBook about a year ago. The version control integration is a game changer. Notion is great for internal notes but not great for customer-facing docs.",
      "GitBook is solid. We also looked at ReadTheDocs but wanted something with less setup overhead. The biggest win is having docs reviewed in the same PR flow as code.",
      "That integration is key. Our biggest problem with Notion was docs drifting from reality. Having docs close to the code keeps them honest.",
    ],
  },
  {
    opening: "Wanted to ask — are you doing anything special for database backups? We had a close call last week and realized our strategy could be better. Looking for battle-tested approaches.",
    replies: [
      "We do hourly snapshots plus WAL archiving to S3. Point-in-time recovery covers the last 7 days. Tested the restore process quarterly — caught a few gaps that way.",
      "Quarterly restore testing is smart. We do monthly but it's mostly automated now. The first time we tested a full restore was terrifying but necessary.",
      "Automated restore testing is the dream. We do it manually and it keeps getting deprioritized. Mind sharing what tooling you use for the automation?",
    ],
  },
  {
    opening: "Hey, small question — we're trying to decide between webhooks and polling for our integration layer. I know webhooks are the modern choice but the reliability concerns give me pause. Thoughts?",
    replies: [
      "We went with webhooks + a backup polling mechanism. Best of both worlds. If the webhook fails, the next polling cycle catches it. Adds some complexity but worth it.",
      "That's what we're leaning toward. Did you build the retry logic in-house or use something like Svix?",
      "Built it in-house since we needed custom retry policies. But honestly, if I were starting over I'd use a managed service. The edge cases in delivery guarantees are deceptively complex.",
    ],
  },
  {
    opening: "Hi, we're planning our Q4 engineering goals and trying to figure out how much to allocate to tech debt vs features. How do you guys balance that?",
    replies: [
      "We use a 70-20-10 split — 70% features, 20% debt, 10% experimentation. The 20% keeps things from rotting and the 10% has produced some surprising wins.",
      "70-20-10 is a good framework. We do something similar but track it at the team level rather than company-wide. Gives each team autonomy on the balance.",
      "Team-level allocation makes sense. We found that a hard company-wide split frustrated everyone. Letting teams decide based on their context worked much better.",
    ],
  },
  {
    opening: "Quick question about monitoring — we're consolidating from 3 different tools into one. Datadog, Grafana, or something else? Would love your take.",
    replies: [
      "We use Grafana + Prometheus and it's been great. Datadog is powerful but the pricing gets aggressive at scale. Grafana's learning curve is steeper but worth it.",
      "Grafana stack here too. The self-hosted option saves a lot compared to Datadog. We supplement with Sentry for error tracking which covers the gaps nicely.",
      "Our stack is Datadog + Sentry. Datadog's APM is genuinely excellent, but yeah, the bill hurts. We've optimized by being selective about what we instrument.",
    ],
  },
  {
    opening: "Hey, we just started using Tailwind v4 and the CSS-first config is a big shift from v3. Have you migrated yet? Wondering how it went for you.",
    replies: [
      "Migrated last month. The v3 to v4 codemod handled most of it. The new oxide engine is noticeably faster — our dev builds went from 4s to under 1s.",
      "The speed improvement alone is worth it. We had a few issues with custom plugins but nothing major. The new @theme directive cleaned up our config significantly.",
      "The @theme directive is a game changer. Our global styles file went from 300 lines to about 40. The dev experience improvement is real.",
    ],
  },
  {
    opening: "Wanted to ask about your experience with microservices vs monoliths. We're debating whether to break up our app and I'd love an honest take from someone who's done it.",
    replies: [
      "Honest answer: only do it if you have a clear scaling bottleneck. Premature microservices cause more problems than they solve. We split too early and paid for it.",
      "Our rule is: don't split until the team is too big for a single codebase. The services overhead is real — deployment, observability, data consistency across services.",
      "The team size heuristic is accurate. We split at around 15 engineers and the communication overhead actually got worse before it got better. Would do it differently in hindsight.",
    ],
  },
  {
    opening: "Hi, we're evaluating React Server Components and I remember you mentioned experimenting with them. How's that been going? Worth adopting yet?",
    replies: [
      "Using them in production for a few months now. The initial setup is awkward but the performance benefits are real. Our core web vital scores improved across the board.",
      "Server components shine for data-heavy pages. The mental model shift is significant though — your team needs to unlearn some client-side habits.",
      "Agreed on the mental model. We trained the team with a few small pages first before touching critical flows. Took about 2 weeks for everyone to get comfortable.",
    ],
  },
  {
    opening: "Quick one — we're getting inconsistent results with A/B testing on email subject lines. Some tests show clear winners, others are flat. What's your minimum sample size before calling a test?",
    replies: [
      "We use 1000 opens per variant minimum. Below that the noise is too high. Also important to run for at least one full business cycle to capture day-of-week effects.",
      "1000 is a good floor. We also watch for the weekend effect — open rates drop on Saturdays even for great subject lines. Our tests always include at least one weekend.",
      "The weekend gap is a real confounder. We standardize on Tue-Thu for tests and extended the minimum duration to 5 days. Smaller lists need even longer to reach significance.",
    ],
  },
  {
    opening: "Hey, question about your security review process — we're implementing a more formal SDL and wondering how you handle third-party dependency vulnerabilities. Any tools you recommend?",
    replies: [
      "We use Dependabot + Snyk. Dependabot catches the obvious ones, Snyk finds deeper issues. Combined they cover most of our supply chain security needs.",
      "Snyk has been worth the cost for us. We also do quarterly full dependency audits where we manually review our critical path dependencies. Tedious but necessary.",
      "We tried Snyk but went with GitHub's native security features. Not as comprehensive but the integration is seamless and adoption was instant since the team already lives in GitHub.",
    ],
  },
  {
    opening: "Hi — we're struggling with our onboarding email sequence conversion rates. We get good open rates but low click-through. Any patterns you've found that work well for driving activation?",
    replies: [
      "We moved from a 5-email sequence to a 3-email sequence with more personalized content and conversion went up 30%. Fewer, better emails outperform volume every time.",
      "The personalization angle is key. We started segmenting by signup source and tailoring the messaging. A user who signed up from a blog needs different onboarding than a referral.",
      "Segmentation by source was our biggest win too. We also added a quick survey in the first email asking what they want to accomplish. The responses feed into the follow-up content.",
    ],
  },
];

const REPLY_PATTERNS = [
  "Hey — appreciate the follow up. Let me check and get back to you on that.",
  "Sounds good. I'll take a look this afternoon and circle back.",
  "Thanks for the note. Let me sync with the team and I'll get back to you.",
  "Got it, thanks for the update. Let me know if anything changes on your end.",
  "Makes sense. I'll follow up once I have more clarity on our end.",
  "Quick reply — yes, that timeline works for us. Let's proceed.",
  "Thanks for keeping me in the loop. Appreciate the heads up.",
  "Perfect, that works. I'll send over the details once we lock things down.",
  "Hey, just saw this. Let me get back to you tomorrow on it.",
  "Noted. Let's touch base again next week and see where things stand.",
];

export class LlmCopywriter {
  generateReply(context: ThreadContext): string {
    const { volleyNumber, previousMessages } = context;

    if (previousMessages.length === 0 && volleyNumber <= 1) {
      return this.pickOpening(context);
    }

    if (previousMessages.length < CONVERSATIONS.length) {
      const scriptIndex = Math.min(
        previousMessages.length,
        CONVERSATIONS.length - 1
      );
      const script = CONVERSATIONS[scriptIndex];
      const replyIndex = Math.min(
        volleyNumber - 2,
        script.replies.length - 1
      );
      if (replyIndex >= 0 && replyIndex < script.replies.length) {
        return script.replies[replyIndex];
      }
    }

    return REPLY_PATTERNS[Math.floor(Math.random() * REPLY_PATTERNS.length)];
  }

  private pickOpening(context: ThreadContext): string {
    const subjectHash = context.subject
      ? context.subject.length % CONVERSATIONS.length
      : Math.floor(Math.random() * CONVERSATIONS.length);
    return CONVERSATIONS[subjectHash].opening;
  }
}

export const llmCopywriter = new LlmCopywriter();