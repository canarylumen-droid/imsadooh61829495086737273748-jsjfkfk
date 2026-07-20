use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyPlanRequest {
    pub daily_cap: u32,
    pub warmup_pct: f64,
    pub campaign_sent_today: u32,
    pub warmup_sent_today: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyPlanResult {
    pub warmup_budget: u32,
    pub campaign_budget: u32,
    pub warmup_remaining: u32,
    pub campaign_remaining: u32,
    pub total_remaining: u32,
    pub warmup_reduced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributeRequest {
    pub mailbox_caps: Vec<MailboxCap>,
    pub leads_by_domain: HashMap<String, u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxCap {
    pub id: String,
    pub provider: String,
    pub domain: Option<String>,
    pub daily_cap: u32,
    pub sent_today: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributeResult {
    pub assignments: Vec<MailboxAssignment>,
    pub unassigned: u32,
    pub exhausted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxAssignment {
    pub mailbox_id: String,
    pub lead_count: u32,
    pub from_domain: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpacingRequest {
    pub campaign_initials: u32,
    pub follow_ups: u32,
    pub warmup_sends: u32,
    pub min_gap_minutes: u32,
    pub hours_active: u32,
    pub start_hour: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpacingSlot {
    pub minute_of_day: u32,
    pub send_type: SendType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SendType {
    CampaignInitial,
    FollowUp,
    Warmup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedistributeRequest {
    pub mailboxes: Vec<RedistMailbox>,
    pub unassigned_count: u32,
    pub is_follow_up: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedistMailbox {
    pub id: String,
    pub daily_cap: u32,
    pub sent_today: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedistributeResult {
    pub assignments: Vec<RedistAssignment>,
    pub carry_over: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedistAssignment {
    pub mailbox_id: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulingJob {
    pub job_type: SchedulingJobType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SchedulingJobType {
    DailyPlan(DailyPlanRequest),
    Distribute(DistributeRequest),
    Spacing(SpacingRequest),
    Redistribute(RedistributeRequest),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulingResult {
    pub job_type: String,
    pub payload: serde_json::Value,
}

pub fn calc_daily_plan(req: &DailyPlanRequest) -> DailyPlanResult {
    let warmup_budget_raw = (req.daily_cap as f64 * req.warmup_pct / 100.0).round() as u32;
    let warmup_budget = warmup_budget_raw.max(1).min(req.daily_cap);
    let campaign_budget = req.daily_cap - warmup_budget;

    let warmup_remaining = if req.warmup_sent_today >= warmup_budget {
        0
    } else {
        warmup_budget - req.warmup_sent_today
    };

    let campaign_sent = req.campaign_sent_today;
    let campaign_remaining = if campaign_sent >= campaign_budget {
        0
    } else {
        campaign_budget - campaign_sent
    };

    let warmup_reduced = if req.warmup_sent_today >= warmup_budget && campaign_sent < campaign_budget {
        true
    } else {
        false
    };

    DailyPlanResult {
        warmup_budget,
        campaign_budget,
        warmup_remaining,
        campaign_remaining: if warmup_remaining == 0 && req.warmup_sent_today < warmup_budget {
            let freed = warmup_budget - req.warmup_sent_today;
            if freed > 0 {
                let overflow = campaign_budget.saturating_sub(req.campaign_sent_today);
                let extra = (freed / 2).min(overflow);
                campaign_remaining + extra
            } else {
                campaign_remaining
            }
        } else {
            campaign_remaining
        },
        total_remaining: req.daily_cap.saturating_sub(req.campaign_sent_today + req.warmup_sent_today),
        warmup_reduced,
    }
}

pub fn distribute_leads(req: &DistributeRequest) -> DistributeResult {
    let total_leads: u32 = req.leads_by_domain.values().sum();
    if req.mailbox_caps.is_empty() {
        return DistributeResult {
            assignments: vec![],
            unassigned: total_leads,
            exhausted: true,
        };
    }

    let mut assignments = Vec::new();
    let mut unassigned = 0u32;
    let mut exhausted = false;

    for (domain, count) in &req.leads_by_domain {
        let domain_lower = domain.to_lowercase();

        let (matched, remaining): (Vec<&MailboxCap>, Vec<&MailboxCap>) = req.mailbox_caps.iter().partition(|m| {
            let provider = m.provider.to_lowercase();
            let m_domain = m.domain.as_deref().unwrap_or("");

            if domain_lower == "gmail.com" || domain_lower == "googlemail.com" {
                provider == "gmail"
            } else if domain_lower == "outlook.com" || domain_lower == "hotmail.com"
                || domain_lower == "live.com" || domain_lower == "msn.com"
            {
                provider == "outlook"
            } else if !m_domain.is_empty() && domain_lower == m_domain {
                true
            } else {
                false
            }
        });

        let candidates = if !matched.is_empty() { matched } else { remaining };
        if candidates.is_empty() {
            unassigned += count;
            exhausted = true;
            continue;
        }

        let available: Vec<&&MailboxCap> = candidates.iter().filter(|m| m.sent_today < m.daily_cap).collect();
        if available.is_empty() {
            unassigned += count;
            exhausted = true;
            continue;
        }

        let total_capacity: u32 = available.iter().map(|m| m.daily_cap.saturating_sub(m.sent_today)).sum();
        if total_capacity == 0 {
            unassigned += count;
            exhausted = true;
            continue;
        }

        let per_mailbox = *count / available.len() as u32;
        let remainder = *count % available.len() as u32;

        for (i, m) in available.iter().enumerate() {
            let cap = m.daily_cap.saturating_sub(m.sent_today);
            let share = if i < remainder as usize {
                per_mailbox + 1
            } else {
                per_mailbox
            };
            let actual = share.min(cap);

            if actual > 0 {
                assignments.push(MailboxAssignment {
                    mailbox_id: m.id.clone(),
                    lead_count: actual,
                    from_domain: domain.clone(),
                });
            }

            if actual < share {
                unassigned += share - actual;
            }
        }
    }

    DistributeResult {
        assignments,
        unassigned,
        exhausted,
    }
}

pub fn calc_spacing(req: &SpacingRequest) -> Vec<SpacingSlot> {
    let total_sends = req.campaign_initials + req.follow_ups + req.warmup_sends;
    if total_sends == 0 || req.hours_active == 0 {
        return vec![];
    }

    let active_minutes = (req.hours_active * 60) as u64;
    let start_minute = (req.start_hour * 60) as u64;

    let ideal_interval = (active_minutes as f64 / total_sends as f64).max(req.min_gap_minutes as f64).min(120.0);
    let mut slots = Vec::with_capacity(total_sends as usize);

    let mut ci_remaining = req.campaign_initials as i64;
    let mut fu_remaining = req.follow_ups as i64;
    let mut wu_remaining = req.warmup_sends as i64;

    let ci_total = ci_remaining;
    let fu_total = fu_remaining;
    let wu_total = wu_remaining;

    let mut minute: f64 = start_minute as f64;
    let mut last_warmup_minute: f64 = -100.0;
    let mut last_campaign_minute: f64 = -100.0;

    let warmup_gap = req.min_gap_minutes.max(10) as f64;
    let campaign_gap = req.min_gap_minutes as f64;

    while (ci_remaining > 0 || fu_remaining > 0 || wu_remaining > 0) && minute < (start_minute + active_minutes) as f64 {
        let warmup_due = wu_remaining > 0
            && (minute - last_warmup_minute) >= warmup_gap
            && (minute - last_campaign_minute) >= campaign_gap;
        let campaign_due = ci_remaining > 0
            && (minute - last_campaign_minute) >= campaign_gap
            && (!warmup_due || wu_remaining <= 0);

        let deadline_approach = minute >= (start_minute + active_minutes) as f64 - (campaign_gap * 2.0);

        if campaign_due || (deadline_approach && ci_remaining > 0) {
            slots.push(SpacingSlot {
                minute_of_day: minute.round() as u32,
                send_type: SendType::CampaignInitial,
            });
            ci_remaining -= 1;
            last_campaign_minute = minute;
        } else if warmup_due {
            slots.push(SpacingSlot {
                minute_of_day: minute.round() as u32,
                send_type: SendType::Warmup,
            });
            wu_remaining -= 1;
            last_warmup_minute = minute;
            last_campaign_minute = minute;
        } else if fu_remaining > 0 && (minute - last_campaign_minute) >= campaign_gap {
            slots.push(SpacingSlot {
                minute_of_day: minute.round() as u32,
                send_type: SendType::FollowUp,
            });
            fu_remaining -= 1;
            last_campaign_minute = minute;
        }

        minute += ideal_interval;
    }

    slots
}

pub fn redistribute(req: &RedistributeRequest) -> RedistributeResult {
    let total_capacity: u32 = req.mailboxes.iter()
        .map(|m| m.daily_cap.saturating_sub(m.sent_today))
        .sum();

    if total_capacity == 0 {
        return RedistributeResult {
            assignments: vec![],
            carry_over: req.unassigned_count,
        };
    }

    if req.is_follow_up {
        return RedistributeResult {
            assignments: vec![],
            carry_over: req.unassigned_count,
        };
    }

    let total = req.unassigned_count;
    let assignable = total.min(total_capacity);
    let carry_over = total.saturating_sub(total_capacity);
    let mut remaining_assignable = assignable;

    let with_capacity: Vec<&RedistMailbox> = req.mailboxes.iter()
        .filter(|m| m.sent_today < m.daily_cap)
        .collect();

    let per_mailbox = if with_capacity.is_empty() {
        0
    } else {
        assignable / with_capacity.len() as u32
    };
    let remainder = if with_capacity.is_empty() {
        0
    } else {
        assignable % with_capacity.len() as u32
    };

    let mut assignments = Vec::new();

    for (i, m) in with_capacity.iter().enumerate() {
        let cap = m.daily_cap.saturating_sub(m.sent_today);
        let share = if i < remainder as usize { per_mailbox + 1 } else { per_mailbox };
        let actual = share.min(cap).min(remaining_assignable);

        if actual > 0 {
            assignments.push(RedistAssignment {
                mailbox_id: m.id.clone(),
                count: actual,
            });
            remaining_assignable = remaining_assignable.saturating_sub(actual);
        }
    }

    let final_carry = carry_over + remaining_assignable;

    RedistributeResult {
        assignments,
        carry_over: final_carry,
    }
}

pub fn dispatch(req: &SchedulingJob) -> SchedulingResult {
    match &req.job_type {
        SchedulingJobType::DailyPlan(d) => {
            let r = calc_daily_plan(d);
            SchedulingResult {
                job_type: "daily_plan".into(),
                payload: serde_json::to_value(r).unwrap_or_default(),
            }
        }
        SchedulingJobType::Distribute(d) => {
            let r = distribute_leads(d);
            SchedulingResult {
                job_type: "distribute".into(),
                payload: serde_json::to_value(r).unwrap_or_default(),
            }
        }
        SchedulingJobType::Spacing(s) => {
            let r = calc_spacing(s);
            SchedulingResult {
                job_type: "spacing".into(),
                payload: serde_json::to_value(r).unwrap_or_default(),
            }
        }
        SchedulingJobType::Redistribute(r) => {
            let r = redistribute(r);
            SchedulingResult {
                job_type: "redistribute".into(),
                payload: serde_json::to_value(r).unwrap_or_default(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calc_daily_plan_basic() {
        let req = DailyPlanRequest {
            daily_cap: 48,
            warmup_pct: 20.0,
            campaign_sent_today: 10,
            warmup_sent_today: 5,
        };
        let r = calc_daily_plan(&req);
        assert_eq!(r.warmup_budget, 10);
        assert_eq!(r.campaign_budget, 38);
        assert_eq!(r.warmup_remaining, 5);
        assert_eq!(r.campaign_remaining, 28);
        assert!(!r.warmup_reduced);
    }

    #[test]
    fn test_calc_daily_plan_warmup_hit_cap() {
        let req = DailyPlanRequest {
            daily_cap: 48,
            warmup_pct: 25.0,
            campaign_sent_today: 40,
            warmup_sent_today: 12,
        };
        let r = calc_daily_plan(&req);
        assert_eq!(r.warmup_budget, 12);
        assert_eq!(r.warmup_remaining, 0);
        assert!(r.warmup_reduced);
    }

    #[test]
    fn test_distribute_even() {
        let mut leads = HashMap::new();
        leads.insert("gmail.com".into(), 10u32);
        leads.insert("outlook.com".into(), 7u32);
        let req = DistributeRequest {
            mailbox_caps: vec![
                MailboxCap {
                    id: "m1".into(), provider: "gmail".into(), domain: None,
                    daily_cap: 50, sent_today: 0,
                },
                MailboxCap {
                    id: "m2".into(), provider: "gmail".into(), domain: None,
                    daily_cap: 50, sent_today: 0,
                },
                MailboxCap {
                    id: "m3".into(), provider: "outlook".into(), domain: None,
                    daily_cap: 50, sent_today: 0,
                },
            ],
        };
        let r = distribute_leads(&req);
        assert_eq!(r.unassigned, 0);
        assert!(!r.exhausted);
        assert_eq!(r.assignments.len(), 3);
        let gmail_total: u32 = r.assignments.iter().filter(|a| a.from_domain == "gmail.com").map(|a| a.lead_count).sum();
        let outlook_total: u32 = r.assignments.iter().filter(|a| a.from_domain == "outlook.com").map(|a| a.lead_count).sum();
        assert_eq!(gmail_total, 10);
        assert_eq!(outlook_total, 7);
    }

    #[test]
    fn test_spacing_basic() {
        let req = SpacingRequest {
            campaign_initials: 24,
            follow_ups: 0,
            warmup_sends: 6,
            min_gap_minutes: 10,
            hours_active: 24,
            start_hour: 0,
        };
        let r = calc_spacing(&req);
        assert!(r.len() <= 30);
        assert!(r.iter().any(|s| s.send_type == SendType::CampaignInitial));
        assert!(r.iter().any(|s| s.send_type == SendType::Warmup));
    }

    #[test]
    fn test_redistribute_follow_up_not_moved() {
        let req = RedistributeRequest {
            mailboxes: vec![
                RedistMailbox { id: "m1".into(), daily_cap: 50, sent_today: 50 },
                RedistMailbox { id: "m2".into(), daily_cap: 50, sent_today: 0 },
            ],
            unassigned_count: 10,
            is_follow_up: true,
        };
        let r = redistribute(&req);
        assert!(r.assignments.is_empty());
        assert_eq!(r.carry_over, 10);
    }

    #[test]
    fn test_redistribute_initials_move() {
        let req = RedistributeRequest {
            mailboxes: vec![
                RedistMailbox { id: "m1".into(), daily_cap: 50, sent_today: 50 },
                RedistMailbox { id: "m2".into(), daily_cap: 50, sent_today: 20 },
                RedistMailbox { id: "m3".into(), daily_cap: 50, sent_today: 10 },
            ],
            unassigned_count: 17,
            is_follow_up: false,
        };
        let r = redistribute(&req);
        assert!(!r.assignments.is_empty());
        let total_assigned: u32 = r.assignments.iter().map(|a| a.count).sum();
        assert_eq!(total_assigned, 17);
        assert_eq!(r.carry_over, 0);
    }
}
