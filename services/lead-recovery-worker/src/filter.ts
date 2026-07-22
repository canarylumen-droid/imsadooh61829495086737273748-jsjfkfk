import type { RecoveryEmail } from "./mailbox.js";

export type EmailCategory =
  | "otp_security"
  | "transactional"
  | "marketing"
  | "auto_reply"
  | "bounce_failure"
  | "social_notification"
  | "calendar_invite"
  | "password_reset"
  | "welcome_onboarding"
  | "account_alert"
  | "system_ci_notification"
  | "delivery_status_report"
  | "forwarded_reply_stripped"
  | "conversational";

interface FilterRule {
  category: EmailCategory;
  label: string;
  pattern: RegExp;
}

const FILTER_RULES: FilterRule[] = [
  // OTP / 2FA / Security codes
  { category: "otp_security", label: "otp_code", pattern: /\b(one[-\s]?time( pass(?:code|word))?|otp|verification code|security code|auth code|2fa|two[-\s]?factor|sign[-\s]?in code|magic sign[-\s]?in|confirm your (?:email|account)|verify your (?:email|account|identity)|login attempt|unusual sign[-\s]?in)\b/i },
  { category: "otp_security", label: "otp_digits", pattern: /^(?:your|here is)(?:\s+\w+){0,4}\s+\d{4,8}\b/i },
  { category: "otp_security", label: "security_alert", pattern: /\b(security alert|suspicious (?:login|activity|attempt)|new device (?:signed|logged|connected)|account.*access.*(?:new|unknown|unusual))\b/i },

  // Transactional (receipts, invoices, orders, shipping)
  { category: "transactional", label: "receipt_invoice", pattern: /\b(receipt|invoice|order confirmation|order #|your (?:order|purchase|receipt)|payment (?:received|confirmed|processed)|billing (?:receipt|summary)|purchase (?:receipt|confirmation)|transaction (?:receipt|confirmation)|thanks for your (?:order|purchase|business))\b/i },
  { category: "transactional", label: "shipping_delivery", pattern: /\b(shipping (?:confirmation|update|details)|your (?:item|package|parcel|shipment) has (?:shipped|been shipped|been dispatched)|out for delivery|delivery (?:estimate|date|update)|package (?:delivered|on its way|en route)|tracking (?:number|details|info)|label created|arriving (?:today|tomorrow))\b/i },
  { category: "transactional", label: "subscription_billing", pattern: /\b(subscription (?:receipt|confirmed|active|renewed)|renewal (?:notice|reminder|receipt)|your (?:plan|membership|subscription) (?:has|is|will)|payment (?:method|declined|failed)|auto[-\s]?renew|trial (?:ending|expired|ended))\b/i },
  { category: "transactional", label: "refund_cancellation", pattern: /\b(refund (?:processed|issued|completed)|cancellation (?:confirmed|processed)|your (?:refund|cancellation)|return (?:confirmed|received|processed))\b/i },
  { category: "transactional", label: "account_statement", pattern: /\b(account (?:statement|summary|activity)|monthly (?:statement|summary)|your (?:recent|monthly) (?:activity|transactions|charges))\b/i },

  // Marketing / Promotional / Newsletters
  { category: "marketing", label: "newsletter", pattern: /\b(newsletter|weekly (?:digest|update|roundup)|monthly (?:digest|update|newsletter|briefing)|(?:this|this week|this month) in (?:news|review))\b/i },
  { category: "marketing", label: "promotion_sale", pattern: /\b(sale (?:ends|now live|is on)|special offer|limited (?:time|offer)|exclusive (?:offer|deal|access)|discount.*inside|(?:save|up to).*% off|huge (?:sale|discount)|flash (?:sale|deal)|don['’]t miss|last chance|act now|offer (?:ends|expires))\b/i },
  { category: "marketing", label: "promotional", pattern: /\b(unsubscribe|(?:to\s)?unsubscribe\s(?:here|now|below)|view in browser|email preferences|email.*not.*display|cancel.*any.*time|(?:you['’]re|you are) receiving this because|(?:you|this) (?:were|was) sent to)\b/i },
  { category: "marketing", label: "product_update", pattern: /\b(product (?:update|launch|announcement)|new (?:feature|product|release)|introducing (?:our|the|a new)|check out our (?:new|latest)|we['’]re excited to (?:announce|launch|introduce))\b/i },
  { category: "marketing", label: "reengagement", pattern: /\b(we miss you|come back|haven['’]t heard from you (?:in|for)|(?:long time|been a while) (?:no see|since we)|we noticed you (?:haven['’]t|stopped)|still interested|reactivate|re[-\s]?engage)\b/i },
  { category: "marketing", label: "webinar_event", pattern: /\b(webinar (?:invitation|registration|reminder|recording)|register (?:now|today|for free)|(?:upcoming|live) (?:webinar|event|workshop)|(?:you['’]re|you are) invited to|save the date|event (?:registration|reminder))\b/i },
  { category: "marketing", label: "referral", pattern: /\b(refer (?:a|your) friend|referral (?:program|bonus|reward)|invite your (?:friends|team|colleagues)|share.*get|give.*get|(?:friend|referral) bonus)\b/i },
  { category: "marketing", label: "review_feedback", pattern: /\b(how (?:was|did) your (?:experience|purchase)|review (?:your|our) (?:product|service|experience)|rate your (?:recent|last)|tell us how we did|feedback (?:request|survey)|we value your feedback|quick (?:survey|poll))\b/i },

  // Auto-replies / Out of Office
  { category: "auto_reply", label: "out_of_office", pattern: /\b(out of (?:the )?office|away from (?:the )?office|on (?:leave|vacation|holiday|sabbatical|maternity|paternity)|auto[-\s]?reply|auto[-\s]?responder|auto[-\s]?generated|canned response|(?:will|shall) be (?:back|returning)(?:\s+\w+){0,4}(?:\d{1,2}\/?){2,4}|not (?:checking|monitoring) (?:email|messages))\b/i },
  { category: "auto_reply", label: "vacation_notice", pattern: /\b(vacation (?:notice|reply|responder)|out of office auto[-\s]?reply|(?:i am|i'm) currently (?:out|away)|limited (?:access|email|availability))\b/i },

  // Bounce / Delivery Failure
  { category: "bounce_failure", label: "bounce", pattern: /\b(mailer[-\s]?daemon|postmaster|mail delivery (?:system|failure|subsystem)|undeliverable|delivery (?:failure|status|failed|not[-\s]?ification)|returned mail|(?:remote|permanent|temporary) (?:delivery )?failure|address (?:rejected|not found|unknown)|user unknown|mailbox (?:full|not found|unavailable)|(?:message|email) (?:could not|failed to) (?:be )?delivered)\b/i },
  { category: "bounce_failure", label: "bounce_code", pattern: /\b(5[0-9]{2}|4[0-9]{2}) (?:permanently|temporarily|rejected|failed)/ },
  { category: "bounce_failure", label: "bounce_fbl", pattern: /\b(this is an (?:automatic|automated) (?:message|response)|reporting[-\s]?MTA|final[-\s]?recipient|remote[-\s]?MTA|diagnostic[-\s]?code|status[-\s]?code)\b/i },

  // Social Media / Platform Notifications
  { category: "social_notification", label: "social_follow", pattern: /\b(followed you on|new (?:follower|connection|contact)|(?:started|began) following you|sent you a (?:connection|friend) request|accepted your (?:connection|friend) request)\b/i },
  { category: "social_notification", label: "social_like_comment", pattern: /\b((?:liked|commented on|reacted to) your (?:post|photo|update|comment|message|status)|(?:new|someone) (?:comment|like|reaction) on|mentioned you in|tagged you (?:in|on))\b/i },
  { category: "social_notification", label: "social_message", pattern: /\b((?:sent|has sent) you a (?:message|direct message|DM)|new message from (?!.*(?:unsubscribe|newsletter))|you have a new (?:match|like|notification))\b/i },

  // Calendar Invites
  { category: "calendar_invite", label: "calendar_invite", pattern: /\b(invitation|invited you|(?:meeting|event|appointment) (?:invitation|confirmed|cancelled|rescheduled|updated)|(?:accepted|declined|tentative) (?:your|the) (?:invitation|meeting|event)|calendar.*(?:invitation|event|update)|new (?:meeting|event|appointment)|outlook.*meeting|google.*calendar)\b/i },
  { category: "calendar_invite", label: "ics_attachment", pattern: /\.ics[\s"]|text\/calendar|content-type:\s*text\/calendar|method:\s*(?:request|publish|cancel|reply)/i },

  // Password Reset
  { category: "password_reset", label: "password_reset", pattern: /\b(password (?:reset|change|update|recovery)|reset your password|change your password|forgot(?:ten)? (?:your )?password|password.*(?:link|button|below)|(?:link|request|code) to reset|recover your (?:account|password))\b/i },

  // Welcome / Onboarding
  { category: "welcome_onboarding", label: "welcome", pattern: /\b(welcome to|thanks?(?: you)? for (?:signing|joining|registering|creating)|(?:your )?(?:account|profile|registration) (?:has been )?(?:created|activated|confirmed)|get started|getting started|(?:begin|start) your (?:trial|journey|setup|onboarding)|(?:you['’]re|you are) (?:now|almost) (?:registered|signed up|a member)|(?:welcome|introductory|orientation) (?:email|guide|series))\b/i },
  { category: "welcome_onboarding", label: "setup_instructions", pattern: /\b(setup (?:guide|instructions|steps)|(?:how to|steps to) (?:get started|set up|configure)|(?:next|first) (?:steps|things to do)|complete your (?:profile|setup|registration))\b/i },

  // Account / Security Alert
  { category: "account_alert", label: "account_change", pattern: /\b(account (?:settings|preferences|details) (?:changed|updated|modified)|(?:email|password|username) (?:changed|updated)|profile (?:updated|changed)\s*(?:successfully)?|(?:new|updated) (?:privacy|terms|policy)|(?:terms|conditions|policy) (?:update|change|notification))\b/i },
  { category: "account_alert", label: "account_notification", pattern: /\b(account (?:notification|notice|alert|activity)|important (?:account|security|billing) (?:information|notice|alert)|action required|requires (?:your )?(?:attention|action|review))\b/i },
  { category: "account_alert", label: "device_login", pattern: /\b((?:new|unusual|unknown) (?:device|location|ip|browser|login|sign[-\s]?in)|(?:signed|logged) in (?:from|on) (?:a|an) (?:new|unknown)|(?:someone|a new device) (?:tried|attempted) to (?:log|sign) in)\b/i },

  // System / CI / DevOps Notifications
  { category: "system_ci_notification", label: "ci_build", pattern: /\b((?:build|deploy|pipeline|CI|CD) (?:passed|failed|succeeded|cancelled|triggered|completed|started)|(?:your|a) (?:build|deploy|deployment) (?:has|was|has been)|(?:deploy|release) (?:notification|summary)|(?:GitHub|GitLab|CircleCI|Jenkins|Travis|Actions|CodeBuild) (?:notification|alert|summary))\b/i },
  { category: "system_ci_notification", label: "code_review", pattern: /\b(pull request|PR|code review|merge request|MR) (?:opened|closed|merged|approved|changes requested|submitted|updated|comment)|(?:new|review) (?:comment|suggestion) on .*(?:PR|MR|pull request|merge request)\b/i },
  { category: "system_ci_notification", label: "monitoring_alert", pattern: /\b((?:uptime|server|monitoring|infrastructure|performance) (?:alert|notification|incident)|(?:server|service|system|site|app) (?:down|unreachable|offline|degraded|error|outage)|(?:error|exception|failure) (?:rate|threshold|alert|notification)|(?:CPU|memory|disk|load) (?:usage|alert|warning|critical)|monitoring.*(?:alert|notification))\b/i },

  // Delivery Status Reports (DSN)
  { category: "delivery_status_report", label: "dsn", pattern: /\b(delivery status (?:notification|report)|(?:DSN|MDN|read[-\s]?receipt|return[-\s]?receipt)|(?:message|email) (?:has been|was) (?:read|opened|viewed|displayed)|(?:delivery|read) (?:receipt|notification) (?:for|from)|your message (?:has been|was) (?:read|opened|delivered))\b/i },

  // Forwarded / Reply with stripped content (Lotus Notes, legacy clients)
  { category: "forwarded_reply_stripped", label: "forward_separator", pattern: /^[>\|]+\s.{0,40}(?:original|forwarded|from|to|cc|bcc|sent|date|subject)/im },
  { category: "forwarded_reply_stripped", label: "forward_header", pattern: /^[-]{2,}forwarded (?:message|by).*[-]{2,}$|^begin forwarded/i },
  { category: "forwarded_reply_stripped", label: "reply_separator", pattern: /^[-]{2,}\s*original (?:message|reply)/im },
  { category: "forwarded_reply_stripped", label: "no_reply_address", pattern: /\b(no[-\s]?reply@|noreply@|donotreply@|do-not-reply@|notifications@|alerts@|mailer@|robot@|bot@|noreply|no\.reply)\b/i },
];

const NOISE_CATEGORIES = new Set<EmailCategory>([
  "otp_security",
  "transactional",
  "marketing",
  "auto_reply",
  "bounce_failure",
  "social_notification",
  "calendar_invite",
  "password_reset",
  "welcome_onboarding",
  "account_alert",
  "system_ci_notification",
  "delivery_status_report",
  "forwarded_reply_stripped",
]);

function classifyEmail(email: RecoveryEmail): { category: EmailCategory; label: string; pattern: RegExp } | null {
  const from = email.from || "";
  const subject = email.subject || "";
  const text = (email.text || "").slice(0, 1000);
  const haystack = `${from}\n${subject}\n${text}`;

  for (const rule of FILTER_RULES) {
    if (rule.pattern.test(haystack)) {
      return { category: rule.category, label: rule.label, pattern: rule.pattern };
    }
  }

  return null;
}

export function shouldFilterEmail(email: RecoveryEmail): { filtered: boolean; reason?: string } {
  if ((email.text || "").trim().length < 12) {
    return { filtered: true, reason: "too_short" };
  }

  const classification = classifyEmail(email);
  if (classification && NOISE_CATEGORIES.has(classification.category)) {
    return { filtered: true, reason: `${classification.category}:${classification.label}` };
  }

  return { filtered: false };
}

export function getEmailClassification(email: RecoveryEmail): EmailCategory {
  const classification = classifyEmail(email);
  return classification ? classification.category : "conversational";
}
