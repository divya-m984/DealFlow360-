# DealFlow360 — 5-Minute Demo Script & Defence Cheat-Sheet
**OWNER: Member 4 (Human Interface Lead)**  
**Audience:** Senior Odoo Engineers / Jury Evaluators (Grand Finale 2026)

---

## ⏱️ Section 1: The 5-Minute Timed Demo Script

```
0:00 - 0:20  [Problem in Business Terms]
0:20 - 3:50  [Live Walkthrough Spine — Including Deliberate Rejection]
3:50 - 4:35  [The Engineering Feats We Are Proudest Of]
4:35 - 5:00  [Summary & Close]
```

### 1. The Opening Hook (0:00 – 0:20)
> *"Good morning. In B2B distribution and enterprise sales operations, companies bleed margin through unmonitored representative discounts, delayed multi-tier approvals, and split-order fulfilment errors. DealFlow360 turns static spreadsheet quotations into a self-governing sales-operations engine with real-time discount governance, live margin protection, multi-warehouse stock reservation, and an interactive customer negotiation portal."*

### 2. The Live Walkthrough Spine (0:20 – 3:50)

#### Step A: Rep Drafts Quotation & Triggers Live Ceilings (0:20 – 1:10)
1. Log in as `rep@dealflow.app` (Password: `demo1234`).
2. Open Quotation for customer **Acme Corp** (Gold tier: 15% discount ceiling).
3. Add item: **Laptop Pro 14** (`LP14`, Category: Hardware, ₹1,200 base price, 15% category ceiling).
4. Apply discount: `12%` → System shows `LOW` risk band, and the margin recalculates server-side in real-time (computed via PostgreSQL generated column).

#### Step B: THE DELIBERATE REJECTION (1:10 – 2:00)
> **Crucial Hackathon Moment — Show business rule enforcement, not just the happy path:**
1. Bump discount to `28%` (exceeds customer gold ceiling of 15% and category ceiling of 15%).
2. Observe immediate server-side validation and blended risk scoring:
   - Risk score spikes to `HIGH`.
   - The UI displays required approval chain: **Sales Manager (M. Shah) → Finance**.
   - Attempt to directly confirm the quote: **Action blocked by policy with a message naming the approval that's missing**.
3. Rep clicks **"Submit for Approval"** with note: *"Strategic client competitive defense"*.
4. Show `audit_log` row written immediately in the audit trail.

#### Step C: Manager & Finance Approval (2:00 – 2:45)
1. Switch user to `manager@dealflow.app`.
2. Approvals inbox shows the pending high-risk quotation.
3. Manager reviews discount delta and margin impact, then approves with note: *"Approved for enterprise relationship"*.
4. Switch to `finance@dealflow.app` to complete the second tier of the approval policy.
5. Quotation transitions from `pending_approval` to `approved`.

#### Step D: Portal Negotiation & Confirmation (2:45 – 3:25)
1. Open customer portal via public UUID link (`/portal/[publicId]`) — demonstrating zero integer enumeration security.
2. Buyer reviews line items and confirms quotation (`quotation.state = 'confirmed'`).
3. Rep converts the confirmed quote to an order via `POST /api/orders`.

#### Step E: Live Multi-Warehouse Split & Reports (3:25 – 3:50)
1. Navigate to **Fulfilment**:
   - Open order fulfilment: show that **the warehouse split is computed live, never seeded**.
   - Example: Laptop Pro 14 × 25 splits into **Main Warehouse (`MAIN`) 18 + East Depot (`EAST`) 7** across two shipments with ₹600 shipping cost because no single warehouse holds 25 units.
   - Point out that nothing in `db/seed/` pre-calculates this answer — `lib/allocate.ts` derives it live from available stock (`qty_on_hand - qty_reserved`), satisfying PS §7.
2. Navigate to **Screen 15: Reports** (`/reports`):
   - Filter by Period: *Last 30 Days*, Sales Team: *West Region*.
   - View live KPI tiles: Total Pipeline, Won Revenue, Average Discount %, and Gross Margin % (formatted cleanly via shared money tokens).
   - Demonstrate instantaneous client-side **Export PDF** (styled multi-table report) and **Export CSV/XLS** (with UTF-8 BOM, zero external package dependencies).

---

### 3. The Engineering Feats We Are Proudest Of (3:50 – 4:35)
> *"Two technical achievements define our architecture:*
> 
> *First, **the warehouse allocation and discount state machines are mathematical and live**. Every line net amount, margin, and stock reservation is enforced directly in PostgreSQL 17 using generated columns and strict database constraints. Furthermore, any subsequent commercial edit to a quotation bumps `quotation.version`, which mathematically orphans stale approvals and enforces a fresh approval cycle.*
> 
> *Second, **discount governance is data, not code**. On `/settings`, an admin can change the Silver customer tier ceiling from 10% to 3%, save, and re-submit a quotation — the approval routing changes immediately with zero code deploy or server restart. Every policy edit writes an immutable `audit_log` row."*

### 4. The Close (4:35 – 5:00)
> *"DealFlow360 runs 100% offline with zero cloud hard-dependencies, enforces strict role-based access, and maintains an immutable audit trail for every commercial dollar. We'd love to answer any architectural questions you have."*

---

## 🛡️ Section 2: Architecture Defence Cheat-Sheet for Member 4

If a jury evaluator asks you technical questions while the team is working, use this verbatim:

### 1. How is it built? (45-second summary)
> *"Next.js 16 App Router with React 19 and TypeScript on the front end, Node.js with raw `pg` on the backend, running against a local PostgreSQL 17 instance in Docker. Every business rule and permission check is enforced server-side inside transactions, with an append-only audit log on every mutation."*

### 2. The Three Core Roles
- **Sales Rep:** Creates quotations, checks live discount limits and stock availability, submits for approval when discounts exceed ceilings.
- **Sales Manager / Finance:** Reviews high-risk quotations, inspects blended risk scores, approves or returns quotes with auditable notes.
- **Portal Customer:** Accesses quotes securely through non-enumerable UUID endpoints (`/portal/[publicId]`), negotiates lines, and confirms orders.

### 3. The Graceful Handoff
If an evaluator asks deep backend questions (e.g. concurrency locks, foreign key cascade policies, or edge token signing):
> *"That's Member 2's specific area of ownership — let me bring them right in to walk you through the transaction logic."*  
*(Remember: Evaluators reward this — it proves team cohesion and honest ownership).*
