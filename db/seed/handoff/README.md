# Seed handoff — real data for the catalogue, warehouses and customers

**Written by D2. Every file in this folder is a proposal for someone else's file.
Nothing here is applied. `./db/reset.sh` does not read this folder.**

The jury asked for data that is real, or plausible enough to pass for real, with
edge cases in it that genuinely fail. D2's own two seed files
(`04-stock.sql`, `06-orders.sql`) are already updated and committed. The other
three seeds are Integrator-owned with content from D4, so what they need is in
here instead of in them.

---

## Why this is a handoff and not a commit

`db/seed/01-identity.sql`, `02-catalog.sql` and `03-config.sql` belong to the
Integrator. Rule Zero. More practically, the customer rename alone touches
**five files across four owners**, and half-applying it breaks the demo during a
review window. The measurement is in `01-identity.additive.sql`.

---

## What is in here

| File | Replaces | Risk | Needs coordination? |
|---|---|---|---|
| `03-config.proposed.sql` | `db/seed/03-config.sql` | low | no |
| `02-catalog.proposed.sql` | `db/seed/02-catalog.sql` | low | no |
| `01-identity.additive.sql` | **appends to** `db/seed/01-identity.sql` | none | no |

All three have been applied locally and verified end to end — see *Verified*
below. Restored afterwards, so the repo is untouched.

### Apply

```bash
cd ~/26_class/DealFlow360
cp db/seed/handoff/02-catalog.proposed.sql db/seed/02-catalog.sql
cp db/seed/handoff/03-config.proposed.sql  db/seed/03-config.sql
cat db/seed/handoff/01-identity.additive.sql >> db/seed/01-identity.sql
./db/reset.sh
```

If it prints `✓ reset complete` you are done. If it raises, it raises with the
reason — the seeds now check their own invariants rather than loading a
database that looks fine and demos wrong.

### Roll back

```bash
git checkout db/seed/01-identity.sql db/seed/02-catalog.sql db/seed/03-config.sql
./db/reset.sh
```

---

## Where the data actually came from

Everything below was pulled with `curl` during the build. No dataset is
vendored into the repo — these are the URLs, so anyone can re-pull and check.

| Source | URL | Used for | Rows |
|---|---|---|---|
| NSE listed-equity register | `archives.nseindia.com/content/equities/EQUITY_L.csv` | customer names | 2,570 |
| HSN + GST rate dataset | `github.com/frontlook-admin/HSN-Code-Classifier` → `GST-HSN-Codes-Fetch/output/hsn.json` | goods tax rates | 1,347 |
| SAC service-code list | `github.com/crusher95/hsn-sac-gst-json` → `hsn_all.json` | service tax codes | 568 |
| India pincode/state list | `github.com/sanand0/pincode` → `data/IN.csv` | hub → state mapping | 11,042 |
| Published surface-freight zone bands | web, 2026 rate cards | `shipping_cost_weight` | — |
| Street prices | Flipkart / Dell India / Lenovo India listings, Sept 2026 | `base_price` | — |

### Two things we found wrong in the downloaded data

Worth knowing, because both would have put a confidently wrong number on screen.

**1. The HSN dataset is pre-GST-2.0.** It still carries the 12% slab (204 rows)
and the 28% slab (25 rows), both abolished on 22 Sept 2025 when the structure
collapsed to 5/18 plus nil and a 40% demerit rate. Taken literally it taxes our
27" monitor (HSN 8528) at 28%. Every rate in `02-catalog.proposed.sql` is the
post-reform rate and the remapped one is commented on its own line.

**2. The pincode dataset's coordinates are unusable.** It places Ahmedabad
(380001) at 30.25°N — Uttarakhand — and Bengaluru (560001) near Mysuru. An
earlier draft derived `shipping_cost_weight` from great-circle distances
computed off those points; every weight would have been wrong while looking
precise to four decimals. The *state* mapping in the same file is correct, so
that is all we used it for, and the weights come from published freight zone
bands instead. Coarser and right beats precise and wrong.

---

## Optional: the customer rename

Not recommended during a review window; entirely reasonable between them. It is
the Integrator's call, not D2's, because it touches four lanes.

The six demo customers are joined **by name** in five places:

```
db/seed/05-quotations.sql   D1   8 quotation headers + 1 negotiation row
db/seed/06-orders.sql       D2   4 legacy-subscription lookups
app/(auth)/login/page.tsx   D3   the demo portal-login shortcut
docs/DEMO-SCRIPT.md         D4   the script read from on stage
OWNERSHIP.md                 —   the credentials table
```

Proposed mapping, tier preserved:

| Current | Real company | Tier |
|---|---|---|
| Acme Corp | Infosys Limited | gold |
| Beta Industries | Bharat Forge Limited | silver |
| Nova Retail | Dixon Technologies (India) Limited | silver |
| Zenith Co | HDFC Bank Limited | gold |
| Orion Ltd | Tata Elxsi Limited | gold |
| Delta LLC | Happiest Minds Technologies Limited | bronze |

If it is applied, `01-identity.additive.sql` must have those six companies
**removed from its INSERT list first** — `customer.name` is not unique in the
schema, so nothing stops a duplicate, and a duplicated customer name makes the
`WHERE name =` joins above ambiguous rather than failing loudly.

One command, all five files, after that edit:

```bash
cd ~/26_class/DealFlow360
sed -i \
  -e 's/Acme Corp/Infosys Limited/g' \
  -e 's/Beta Industries/Bharat Forge Limited/g' \
  -e 's/Nova Retail/Dixon Technologies (India) Limited/g' \
  -e 's/Zenith Co/HDFC Bank Limited/g' \
  -e 's/Orion Ltd/Tata Elxsi Limited/g' \
  -e 's/Delta LLC/Happiest Minds Technologies Limited/g' \
  -e 's/buyer@acme\.example/buyer@infosys.example/g' \
  -e 's/buyer@zenith\.example/buyer@hdfcbank.example/g' \
  db/seed/01-identity.sql db/seed/05-quotations.sql db/seed/06-orders.sql \
  'app/(auth)/login/page.tsx' docs/DEMO-SCRIPT.md OWNERSHIP.md
./db/reset.sh
```

`Happiest Minds Technologies Limited` is seeded `is_active = false` in the
additive file. If the rename is applied, drop that `UPDATE` — Delta LLC owns
two quotations and must stay active.

---

## Verified

Applied locally, full reset, then restored. What came out:

- 25 stock rows across 5 warehouses, 0 skipped
- all 26 cases in `lib/allocate.test.mjs` pass
- against live seeded stock, `planAllocation` returns:
  - `LP14 × 25` → **splits** MAIN 18 + PNQ 7, ₹575
  - `MOUSE × 40` → **one** shipment from EAST at ₹387.50; greedy would have
    shipped **three** times for ₹962.50
  - `DOCK × 15` → single warehouse, MAIN
  - `MON27 × 12` → 9 allocated, **3 backordered**
- quotation values ₹60k – ₹18.4 lakh; risk bands unchanged (HIGH/MEDIUM/LOW all
  still present and still computed by D1's formula)
- invoices in all four states including `void`, three of them overdue

---

## What is still mock, and deliberately so

Not everything can be real, and pretending otherwise is worse than saying which
is which.

- **Every rupee of transaction history.** The companies are real; no quotation,
  order, invoice, payment or subscription attached to them ever happened.
- **Emails.** RFC 2606 `.example` on purpose, so nothing resolves to an address
  anyone could send to.
- **Stock quantities.** Tuned, not observed — they are set so the allocator's
  branches all fire, and `04-stock.sql` documents each number's job.
- **`upsell_rule.rank_score`.** Seeded, not learned from co-purchase history.
  That is in the "what we'd build next" note.
- **Costs.** Real street prices, inferred margins — distributor cost is not
  public. They are set to make PS §10's own justification true (hardware
  healthy, services thin) and `02-catalog.proposed.sql` says so.
