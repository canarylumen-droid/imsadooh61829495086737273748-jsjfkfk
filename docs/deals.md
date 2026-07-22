# Deals Pipeline

## Overview

The deals pipeline tracks sales opportunities through stages from initial contact to closed won/lost.

### Deal Stages

| Stage | Label | Color | Description |
|---|---|---|---|
| `new` | New | gray | Initial entry into pipeline |
| `qualified` | Qualified | sky | Lead confirmed as legitimate opportunity |
| `demo` | Demo Scheduled | blue | Product demo or call scheduled |
| `proposal` | Proposal | indigo | Proposal sent |
| `negotiation` | Negotiation | amber | Price/terms being negotiated |
| `pending_payment` | Pending Payment | amber/red | Payment pending receipt |
| `booked` | Booked | emerald | Deal closed, booked |
| `lost` | Not Interested | red | Deal lost |
| `closed` | Closed Won | emerald | Deal won |

### UI Components

- **Pipeline view**: Kanban-style columns by stage
- **Deal cards**: Company name, value, contact name, stage badge
- **Drag-and-drop**: Move deals between stages
- **Value tracking**: Summed by stage, shows total pipeline value

### API Endpoints

```
GET    /api/deals                    → List deals
POST   /api/deals                    → Create deal
GET    /api/deals/:id                → Deal details
PATCH  /api/deals/:id                → Update deal (stage, value, etc)
DELETE /api/deals/:id                → Delete deal
```

### Deal Model

```typescript
interface Deal {
  id: string;
  userId: string;
  leadId?: string;     // Associated lead (optional)
  contactName: string;
  companyName: string;
  value: number;        // Deal value in dollars
  value2?: number;      // Secondary deal value
  stage: DealStage;
  probability: number;  // 0-100
  expectedCloseDate?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Settings Integration

- Average Deal Value configured in user settings (`offerValue`, `offerValue2`)
- Used by AI (Fathom autonomous agent) for deal-aware decisions
- Values persist across sessions
- Affect deal probability scoring

### Fathom AI Agent

- Autonomous deal management agent
- Analyzes deal progression patterns
- Suggests optimal next actions per deal stage
- Updates deal probability based on:
  - Lead engagement level
  - Conversation sentiment
  - Time in current stage
  - Historical conversion patterns
