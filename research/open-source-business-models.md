# Open Source Business Models: Research for ClauseFlow

> Prepared: 2026-05-09
> Focus: How open source companies actually monetize, with real numbers and honest tradeoffs — for ClauseFlow (AGPL-3.0, self-hostable CLM, targeting SMB legal/ops teams)

---

## TL;DR — 5 Most Actionable Insights

1. **Hosted SaaS is the only model that reliably scales for SMB targets.** Open core and support/services work for developer tools with large communities; for a vertical B2B tool targeting ops/legal teams (not developers), the cloud hosting tier IS the product. ClauseFlow should build a one-click cloud tier immediately after OSS launch.

2. **Self-hosters almost never convert. Design around that fact.** Industry-wide conversion rate from free self-hosted to paid cloud is well below 1–3%. The self-hosted edition is a marketing flywheel, not a revenue pipeline. Revenue comes from organizations that don't want to run infrastructure — treat self-hosting as proof-of-concept, not step 1 of a funnel.

3. **AGPL creates real leverage against cloud competitors, but does not drive user-to-cloud conversions.** AGPL blocks AWS/GCP from reselling ClauseFlow as a managed service without open-sourcing their modifications — that matters at scale. It does not compel a self-hoster to pay for cloud. The commercial license escape hatch (sell dual licenses for enterprises that want to embed/resell) is the real AGPL monetization play.

4. **The winning playbook for this exact market is: OSS core + cloud hosting + enterprise tier.** Metabase ($500/mo cloud, $20K+/yr enterprise), n8n ($40M ARR), PostHog ($9.5M ARR), and Plausible ($1M+ ARR bootstrapped) all do this. The split between what's free vs. paid matters enormously — put the things ops/legal teams don't want to manage (SSO, audit logs, SLAs, unlimited AI queries) behind the paid tier.

5. **Don't switch licenses once the community is established.** HashiCorp's BSL move created an OpenTF fork and lasting community backlash. If ClauseFlow's AGPL is a problem later, sell a commercial dual license — don't reclassify the OSS edition. Every license change generates negative press and forks.

---

## 1. Business Model Archetypes

### 1.1 Open Core

**How it works:** Core product is fully open source. Enterprise/premium features (SSO, audit logs, advanced security, role management, analytics) live behind a proprietary license. Users can use the free edition indefinitely; they pay when they hit enterprise-grade needs.

**Who it works for:**
- Developer tools with large communities (GitLab, PostHog, Airbyte)
- Products where the enterprise buyer is different from the individual user (individual dev self-hosts → IT/security team at enterprise pays)
- Projects with enough community pull that the OSS version has real ecosystem gravity

**Who it fails for:**
- Small teams targeting SMB with no IT/security procurement layer
- Tools where the community won't contribute because the "good parts" are closed
- Teams that can't maintain two editions (doubles engineering burden)

**Key risk:** Community resentment if the line between free and paid features feels extractive. Elastic's 2021 relicensing and the subsequent AWS OpenSearch fork is the canonical failure.

---

### 1.2 SaaS / Hosted Cloud (Pure Play)

**How it works:** The software is open source, but you offer a managed cloud version. Revenue comes entirely from hosting, operational expertise, SLAs, and convenience. Plausible is the clearest example — zero proprietary features, 100% cloud-subscription revenue.

**Who it works for:**
- Tools where self-hosting is genuinely painful (databases, complex infrastructure)
- Privacy/compliance tools where the cloud provider IS the differentiator
- Bootstrapped teams that want simplicity over open-core complexity

**Who it fails for:**
- Tools that are trivially easy to self-host (low hosting-friction = low cloud conversion incentive)
- Hyper-competitive markets where AWS/GCP will undercut on infrastructure cost

**Key advantage:** No license drama. Community gets 100% of the code. Trust is maximized.

---

### 1.3 Support / Services

**How it works:** Software is free; you sell professional services, implementation, training, and support contracts. RedHat built a $3B+ business this way.

**Who it works for:**
- Infrastructure software with complex deployment (Linux, databases, message queues)
- Enterprise buyers who need SLA-backed support and certified implementations
- Very large open source projects with massive adoption

**Who it fails for:**
- SMB targets who expect self-service and won't pay for support
- Small teams — support doesn't scale without a large team
- SaaS-era expectations — developers prefer documentation to paid support

**Verdict for ClauseFlow:** Not viable as primary revenue. Legal/ops teams at 20-200 person companies will not pay $X0,000/yr for support contracts. They want the product to work.

---

### 1.4 Dual License

**How it works:** OSS edition under AGPL/GPL; commercial license for organizations that can't comply with AGPL (typically: embedding in proprietary products, building on it without open-sourcing their modifications, or reselling as a managed service). Common among database projects (MySQL/MariaDB, MongoDB historically).

**Who it works for:**
- Projects with genuine embeddability use cases (others want to build on top of your code)
- AGPL-licensed software where compliance friction is real and measurable
- Developer tools or libraries, not end-user applications

**Who it fails for:**
- End-user applications where organizations use, not embed, the software
- SMB targets — dual licensing revenue is an enterprise play, ACV $10K–$100K+

**Verdict for ClauseFlow:** Viable as a secondary revenue stream once there's ecosystem adoption. If SIs or larger SaaS companies want to white-label ClauseFlow or embed it, dual-license that. Not a primary go-to-market.

---

### 1.5 Marketplace / Platform

**How it works:** The core is free; revenue comes from a marketplace of templates, integrations, plugins, or professional services built by third parties. Salesforce AppExchange is the model; smaller examples include n8n's template library.

**Who it works for:**
- Platforms with deep integration ecosystems
- Products where users want customization beyond the core
- Large-enough communities that third parties want distribution via your marketplace

**Who it fails for:**
- Early-stage products without enough users to attract third-party vendors
- Vertical B2B tools with limited integration surface

**Verdict for ClauseFlow:** Aspirational, not launch-day. A clause library or template marketplace is a v2+ play (already in the roadmap as M6).

---

### 1.6 Freemium

**How it works:** Free tier with usage limits; paid tier with more capacity, more seats, or more advanced features. Nearly all modern SaaS does this.

**Who it works for:**
- Almost everything when combined with another primary model

**Reality:** Freemium is a pricing tactic, not a standalone business model. Every company on this list does freemium + something else.

---

## 2. Case Studies

### 2.1 GitLab — Open Core Done Right

**What they open sourced:** Full DevSecOps platform — issues, pipelines, code review, wikis, container registry. MIT license.

**What they charge for:** Advanced security scanning, compliance dashboards, enterprise SSO/SAML, advanced analytics, DORA metrics, audit events. Roughly 500+ enterprise features behind paid tiers.

**Revenue:** $579M in FY2024 (ended Jan 31, 2024). Over 30,000 paying customers; 50%+ of Fortune 100 use GitLab in some capacity.

**Model breakdown:** Subscriptions to GitLab SaaS or self-managed enterprise edition. Two-tier pricing: Premium (~$19/user/mo) and Ultimate (~$99/user/mo).

**What worked:**
- Strong open-source community built trust and adoption before monetization
- Enterprise features (compliance, security, governance) are genuinely things enterprises need but developers don't
- "Buyer-based open core" — the buyer (IT/security/compliance) is different from the user (dev), so there's a natural upsell path
- IPO in 2021 validated the model at massive scale

**What didn't:**
- Community tension over which features go into the open vs. paid edition — GitLab publishes a public page explaining their open core tiers to manage this
- Building and maintaining two editions is expensive

**Lesson for ClauseFlow:** The org-level buyer (General Counsel, VP of Ops) is different from the end user (contract manager, salesperson). That gap is the upsell surface. Features that GC cares about (audit trail, SSO, data residency) go in the enterprise tier. Features that contract managers care about (AI extraction, search, e-sign) go in the core.

---

### 2.2 HashiCorp — The BSL Warning

**What happened:** In August 2023, HashiCorp switched Terraform, Vault, Consul, Nomad, and Packer from MPL 2.0 to Business Source License (BSL 1.1). BSL prohibits using the code to build competing products or managed services.

**Why they switched:** Co-founder Armon Dadgar: "There are vendors who fork the OSS projects and resell them, directly competing with HashiCorp, without providing material contributions back." Specifically targeting managed Terraform/Vault providers (Spacelift, env0, Scalr) who were building businesses on top of HashiCorp's work.

**What happened next:**
- OpenTF (now OpenTofu) forked Terraform within days under MPL 2.0. Linux Foundation backed it.
- Community backlash was severe and immediate
- IBM acquired HashiCorp in April 2024 for $6.4B — the BSL was arguably a move to clean up licensing before acquisition, not a sustainable long-term strategy
- OpenTofu now has significant adoption, arguably weakening Terraform's moat

**The lesson:** Switching licenses after community formation is irreversible in terms of trust damage. The fork will happen. IBM bought HashiCorp despite (or because of) the controversy, but the community moat was damaged. If you're going to be restrictive, start restrictive (AGPL) rather than switching later.

**Lesson for ClauseFlow:** AGPL from day one is the right call. Never switch from a more permissive to a more restrictive license — the community will fork and the press will be bad. The commercial dual-license option preserves flexibility without betraying existing adopters.

---

### 2.3 Metabase — Open Core BI for Non-Devs

**What they open sourced:** Core BI platform — dashboards, queries, visualizations, basic permissions. AGPL v3.

**What they charge for:**
- Cloud hosting: $500/mo (10 users) → $10/additional user; $5,400/yr annual
- Pro: $12/user/mo
- Enterprise: $20,000+/yr

**Revenue:** Private company; no public revenue figures. Has raised ~$61M. Median customer paying ~$6,100/yr.

**What worked:**
- Target market is ops/analytics teams (similar to ClauseFlow's target), not just developers
- AGPL chosen explicitly to prevent SaaS resellers from hosting it without contributing back
- Very low sales/marketing spend — product-led growth driven by the free open-source version
- "We don't have a big sales team, and we don't spend on paid ads"

**What didn't:**
- AGPL generated legal uncertainty for some enterprises — companies have policies blocking AGPL adoption for internal tools
- Self-hosted version is genuinely popular; conversion to cloud is a challenge

**Lesson for ClauseFlow:** Metabase's target buyer (ops/analytics, non-developer) maps almost exactly to ClauseFlow's (ops/legal). The AGPL + cloud-hosted model is viable. Prioritize making the cloud tier the zero-friction option — self-hosting should feel like work relative to cloud.

---

### 2.4 Supabase — Open Source SaaS, Venture Backed

**What they open sourced:** Full Firebase alternative — auth, database (Postgres), storage, realtime, edge functions. Apache 2.0.

**What they charge for:** Cloud hosting. Pricing: Free (50K MAUs, 500MB DB) → Pro ($25/mo, 8GB DB) → Team ($599/mo, enterprise compliance).

**Revenue:** $70M ARR in 2025, up from $30M end of 2024. $200M raised at $2B valuation (2025).

**What worked:**
- Strong developer brand — extremely active GitHub community (72K+ stars)
- Postgres-native positioning — riding the wave of Postgres adoption
- AI developer tailwind — became a default backend for vibe-coding apps in 2024-25
- Free tier is genuinely generous, creates fast initial adoption

**What didn't:**
- Heavily venture-dependent — $70M ARR with $200M+ raised means still burning cash
- Competing with AWS RDS, PlanetScale, Neon on hosting

**Lesson for ClauseFlow:** Supabase shows that "open source + cloud hosting" can scale to $70M ARR — but requires significant VC or patient bootstrap capital to reach that size. The developer community flywheel took 4+ years to build.

---

### 2.5 Plausible Analytics — Bootstrapped Open Source SaaS

**What they open sourced:** Complete analytics codebase. AGPL.

**What they charge for:** Cloud hosting only. No proprietary features. The self-hosted community edition has the same code as the cloud version.

**Revenue:** $1M+ ARR as of 2022 (bootstrapped, 4-person team, intentionally small).

**What worked:**
- Regulatory tailwind: EU GDPR enforcement against Google Analytics in 2022 drove organic traffic
- Content marketing: zero paid ads, multiple Hacker News front pages
- Privacy positioning: the AGPL choice reinforced their privacy-first brand
- Bootstrapped = no VC pressure, sustainable unit economics

**What didn't:**
- Scale is deliberately small. At $1M ARR with 4 people, it's a lifestyle business, not a venture-scale company
- Self-hosted community edition means some users never convert — acceptable for them, not for VC-backed companies

**Lesson for ClauseFlow:** Plausible proves the model works, but at a small scale. For ClauseFlow to reach meaningful revenue ($5M–$20M ARR), you need either VC backing and aggressive growth, or patient bootstrapping over 5+ years. Pick your path before setting expectations.

---

### 2.6 Cal.com — Open Core Scheduling

**What they open sourced:** Core scheduling infrastructure, API, integrations. MIT license.

**What they charge for:** Cal.com Cloud hosting (Pro, Teams, Enterprise). Platform API ($299+/mo for embedded scheduling).

**Revenue:** $5.1M in 2024 (up from $1.6M in 2023). Raised $32M.

**What worked:**
- Strong GitHub growth (30K+ stars) drove enterprise leads
- "Open scheduling infrastructure" positioning — sell picks-and-shovels, not just a product
- Platform/embedded tier ($299+/mo) is the interesting play — companies embed Cal.com into their own products

**What didn't:**
- Self-hosters who use it for free are a large cohort; conversion to cloud requires active friction engineering
- Revenue is still small relative to funding

**Lesson for ClauseFlow:** Cal.com's embedded API tier ($299/mo+) is interesting precedent. If ClauseFlow's MCP server and API become popular with developers building contract automation, an "embedded" or "platform" tier could be significant revenue.

---

### 2.7 PostHog — Open Source Analytics with Transparent Pricing

**What they open sourced:** Full product analytics platform (MIT license for community; paid cloud tier).

**What they charge for:** Cloud hosting at usage-based pricing. Events on a sliding scale; session replay separate. Generous free tier (1M events/mo free). 98% of users on free tier.

**Revenue:** ~$9.5M ARR (2024), $70M Series D at $920M valuation.

**What worked:**
- Transparent, usage-based pricing — published openly, no sales calls needed for small teams
- Product-led growth: developers discover it, champion it internally, upgrade to cloud as usage grows
- Self-hosted → cloud: PostHog deliberately makes self-hosting feel like work above 300K events/mo by not supporting it beyond that threshold
- Multiple products bundled (analytics + replay + flags + surveys) — increases expansion revenue

**What didn't:**
- Self-hosted edition is still popular; PostHog's response is to make cloud genuinely better operationally rather than feature-gating
- 98% free users means revenue depends on a small slice of high-volume customers

**Lesson for ClauseFlow:** PostHog's approach of making self-hosting "officially unsupported above X scale" is a smart conversion wedge — not feature-gating, but complexity-gating. For ClauseFlow: make the cloud tier operationally superior (auto-updates, backups, monitoring) rather than feature-restricting the OSS edition.

---

### 2.8 Airbyte — Open Source Data Integration

**What they open sourced:** Full data connector platform (MIT/ELv2). 550+ connectors.

**What they charge for:** Airbyte Cloud (usage-based, per-connector-credit). Enterprise self-hosted license. 40,000+ daily active companies.

**Revenue:** 4× growth in revenue in H1 2024 (specific ARR not disclosed publicly). Raised $181M total.

**What worked:**
- Community-built connectors reduced Airbyte's development cost dramatically — network effects in open source
- Usage-based pricing aligned with data engineering scale-up patterns
- "Open source first" created a moat against commercial alternatives (Fivetran, Stitch)

**What didn't:**
- Connector quality is inconsistent when community builds them — support burden high
- Enterprise License v2 (ELv2) replaced OSS license for certain features, creating community friction (similar to Elastic)

**Lesson for ClauseFlow:** Airbyte shows that in a space where community contribution reduces your dev cost (e.g., integration connectors), OSS is a clear advantage. For ClauseFlow, contract templates and clause libraries could be a similar community contribution vector.

---

### 2.9 n8n — Fair-Code Workflow Automation

**What they open sourced:** Full workflow automation platform. "Sustainable Use License" (not OSI-certified open source) — free for internal use, requires commercial license if you offer it as a service.

**What they charge for:** Cloud hosting ($20/mo Starter → $50/mo Pro → custom Enterprise). Enterprise self-hosted license.

**Revenue:** $40M ARR (July 2025). $180M Series C at $2.5B valuation (October 2025). 55% cloud subscriptions, 30% enterprise licenses, 15% embedded/OEM.

**What worked:**
- Sustainable Use License (not AGPL) created a harder commercial boundary than AGPL would have — you cannot legally offer n8n as a hosted service without paying
- Execution-based pricing (per workflow run) scales with customer success
- Strong developer community despite the non-OSI license
- AI workflow positioning in 2024-25 drove dramatic acceleration

**What didn't:**
- The Sustainable Use License generated debate about whether n8n is "truly open source" — affects community perception
- Still requires significant VC to grow at this rate

**Lesson for ClauseFlow:** n8n's model is the closest analogue. Self-hostable, workflow automation, B2B SaaS target, strong developer community. The key difference: AGPL (ClauseFlow) is weaker than Sustainable Use License for preventing competitive managed services — but AGPL is cleaner for community trust. The n8n revenue numbers ($40M ARR) show this market can generate real revenue.

---

## 3. AGPL-3.0 as a Moat — Does It Work?

### What AGPL Actually Does

AGPL extends GPL's copyleft to network services. Under AGPL:
- You can self-host ClauseFlow for internal use: **free, no restriction**
- You can modify ClauseFlow and use it internally: **free, must share modifications back**
- You want to offer ClauseFlow as a managed service to others: **must open-source your full service stack, or buy a commercial license**
- AWS/GCP wants to offer "Managed ClauseFlow": **must open-source everything or buy a commercial license**

### What AGPL Does NOT Do

- It does not stop self-hosters from using ClauseFlow for free
- It does not drive cloud conversion among individuals or SMBs — legal compliance is not a purchase trigger for ops teams
- It does not prevent forks (but forces forks to remain AGPL)

### Companies Using AGPL as a Moat

**Grafana Labs (2021):** Switched from Apache 2.0 to AGPLv3 to prevent "strip-mining" — cloud providers offering Grafana as a managed service without contributing. CEO: "We chose AGPLv3 instead of SSPL because we wanted to stay OSI-approved." Also offers enterprise binary under proprietary license (the "escape hatch"). Revenue: over $100M ARR.

**Metabase:** AGPL from day one. Explicitly chosen to prevent SaaS resellers. Community edition and cloud edition share the same code. Enterprise features under proprietary license.

**Plausible:** AGPL — reinforces their privacy-first brand. No commercial proprietary layer; just cloud hosting revenue.

**MongoDB (SSPL, not AGPL):** MongoDB's Server Side Public License is even more restrictive — requires that if you offer MongoDB as a managed service, you must open-source not just your modifications but the entire stack (OS, orchestration, management tools). AWS forked and created DocumentDB rather than comply. SSPL is not OSI-approved.

### The Commercial License Escape Hatch

The dual-license path: AGPL for community; commercial license for:
1. Companies that want to embed ClauseFlow in their product (ISVs, no-code platforms)
2. SIs that want to offer ClauseFlow as a managed service for clients
3. Enterprises with legal policies prohibiting AGPL in internal tools

Pricing precedent: typically $10K–$100K/yr depending on deployment size. This is an enterprise B2B sale, not self-serve.

### Evidence That AGPL Drives Cloud Conversions

Weak. AGPL primarily deters *commercial competitors*, not end users. End users choose cloud over self-hosting for operational reasons (convenience, support, uptime), not legal reasons. The data consistently shows that operational convenience is the primary cloud conversion driver, not license compliance anxiety.

**Bottom line on AGPL:** Correct choice for ClauseFlow. It protects against large-cloud-player strip-mining (a real risk if the product gets traction), preserves community trust (OSI-approved, open source by definition), and creates a dual-license commercial path for enterprises. Do not expect it to meaningfully drive user-to-cloud conversions.

---

## 4. Failure Modes — The Open Source Trap

### 4.1 Self-Hosters Never Convert

The conversion rate from free self-hosted to paid cloud is well below 1% in most open source projects. The population of self-hosters is predominantly: developers evaluating the product, cost-sensitive organizations with the DevOps capacity to run it themselves, and international markets where pricing is prohibitive.

None of these groups convert at meaningful rates. **Design for this reality.** The self-hosted edition is a marketing flywheel (GitHub stars, developer credibility, inbound enterprise leads), not a sales funnel.

### 4.2 Community vs. Commercial Tension

Open core creates a permanent tension: which features go in the free edition? Moving features from free to paid generates backlash. Never moving features generates business failure.

Elastic's 2021 relicensing is the clearest failure case: AWS forked Elasticsearch as OpenSearch, backed by Linux Foundation, now has significant enterprise adoption. Elastic lost the narrative, the fork, and damaged community trust — all while still growing revenue (to $1B+ ARR), which shows you can survive community backlash if your enterprise base is strong, but it's painful.

GitLab manages this with a published public policy explaining which features belong in which tier and why. The policy itself is OSS. This transparency reduces (not eliminates) resentment.

### 4.3 The HashiCorp Lesson

Switching from permissive (MPL) to restrictive (BSL) after community formation generates immediate fork. OpenTofu (the Terraform fork) now has Pulumi, Spacelift, and other commercial backing. HashiCorp/IBM got acquired at $6.4B, so financially the BSL move worked — but the community is permanently bifurcated. The moat was weakened, not strengthened.

**The lesson:** Be restrictive from day one. Switching later is high-cost. AGPL from launch is correct.

### 4.4 Race to Zero on Features

If the open edition has too many features, there's nothing to sell. If it has too few, community won't adopt. The line should be:

- **In open edition:** everything a single organization needs to manage their own contracts
- **Behind paid tier:** things that require ClauseFlow to provide operational guarantees (SLAs, uptime, backups), things that IT/compliance buyers need (SSO, detailed audit logs, data residency), and AI usage beyond generous limits

### 4.5 VC vs. Bootstrap Mismatch

Supabase ($200M raised, $70M ARR) and PostHog ($107M raised, $9.5M ARR) are burning significant cash. The economics of open source community building require years of investment before payoff. If ClauseFlow is bootstrapped, target unit economics from year 1: the Plausible model (small, profitable, sustainable) is achievable. If VC-backed, the n8n/PostHog model ($40–70M ARR) is the target, but requires $10–50M+ investment.

---

## 5. Pricing Benchmarks

### Comparable Open Source Tools — Cloud Tier Pricing

| Company | What It Does | Free Tier | Starter | Pro/Growth | Enterprise |
|---|---|---|---|---|---|
| Metabase | BI / analytics | Self-host only | $500/mo (10 users) | $12/user/mo | $20K+/yr |
| PostHog | Product analytics | 1M events/mo | Usage-based ($0.00031/event) | Usage-based | Custom |
| n8n | Workflow automation | Self-host free | $20/mo (2.5K runs) | $50/mo (10K runs) | Custom |
| Cal.com | Scheduling | Self-host free | $12/user/mo | $19/user/mo | Custom |
| Plausible | Web analytics | None | $9/mo (10K pageviews) | $19/mo (100K pageviews) | Custom |
| Documenso | E-signature | Self-host free | $30/mo | $50/mo | Custom |
| DocuSeal | E-signature | Free (self-host + cloud) | $29/mo (cloud) | — | Custom |

### CLM Market Pricing (Commercial Tools, for Reference)

| Tier | Price Range | Who It's For |
|---|---|---|
| SMB CLM (Juro, Concord, Zefort) | $30–$100/user/mo | 10-50 seat ops/legal teams |
| Mid-market CLM | $15K–$50K/yr flat | 50-200 seat organizations |
| Enterprise CLM (Ironclad, Conga, DocuSign CLM) | $50K–$500K+/yr | Large legal/procurement orgs |
| Open source / self-hosted | $0 software cost | Technical teams with DevOps capacity |

### Pricing Recommendation for ClauseFlow Cloud

Based on comparables and target market (20-200 person B2B SaaS companies, ops/legal teams):

- **Free (Cloud):** 3 users, 10 contracts, basic AI extraction (limited)
- **Starter:** $49/mo — 5 users, 100 contracts, full AI extraction, e-sign
- **Growth:** $149/mo — 20 users, unlimited contracts, semantic search, alerts, API
- **Enterprise:** Custom / $500+/mo — SSO, audit logs, data residency, SLA, unlimited API

This is below mid-market CLM pricing ($30–$100/user/mo), which is intentional — ClauseFlow's OSS positioning lets it undercut commercial tools while the self-hosting option provides a natural floor below which only the most cost-sensitive or technical buyers go.

---

## 6. Recommendation for ClauseFlow

### The Model: OSS Core + Cloud SaaS + Enterprise Dual License

**Phase 1 (Now — Post M4 Launch):**
- Ship the AGPL OSS edition. Market it as the self-hostable, open-source CLM.
- Launch cloud-hosted tier simultaneously (or within 60 days). Don't wait. Every week without a cloud tier is a week of lost conversion.
- Free cloud tier with limits to drive signups.
- Pricing: $49/$149/custom as above.

**Phase 2 (6–18 months after launch):**
- Build the enterprise conversion path. SSO, audit logs, data residency, dedicated support.
- Begin commercial license conversations with SIs and ISVs who want to embed ClauseFlow.
- GitHub stars → enterprise inbound → sales.

**Phase 3 (18+ months):**
- Clause library marketplace (M6 roadmap) — community contributes templates, ClauseFlow curates and distributes.
- API/platform tier for developers building on ClauseFlow (embedded contracts in their SaaS products).

### What to Put in the Free Edition vs. Behind Cloud

**Keep in OSS / free forever:**
- Full contract repository (CRUD, upload, organize)
- AI extraction (with self-managed AI keys)
- Full-text + semantic search
- Approval workflows
- E-signature via DocuSeal
- API access (with self-managed rate limits)
- MCP server

**Put behind Cloud paid tier:**
- Managed uptime SLA, automated backups
- Generous AI query limits (above free caps)
- Team management for large orgs
- Renewal alerts and email notifications (managed delivery)
- Audit trail with export

**Put behind Enterprise tier (proprietary):**
- SSO/SAML
- Detailed compliance audit logs
- Data residency (EU/US region choice)
- Priority support with SLA
- Unlimited API, no rate limits
- White-label / embedding rights (commercial license)

### The Key Decisions

1. **Do not gate AI extraction behind cloud only.** It's a core feature and your biggest differentiation vs. incumbents. Self-hosters can bring their own API keys. This maximizes adoption and GitHub stars.

2. **Make cloud operationally superior, not feature superior.** PostHog's approach: self-hosting is free but unsupported above X scale. Cloud is just easier. Don't create a feature war between OSS and cloud editions — create a convenience war.

3. **Keep the OSS edition genuinely good.** Metabase's AGPL edition is the same core product. This is what builds developer trust, GitHub stars, and inbound enterprise leads. A crippled OSS edition generates resentment, not community.

4. **Set realistic conversion expectations.** The self-hosted user base is a marketing asset, not a sales pipeline. Measure OSS success by stars and deployments; measure business success by cloud ARR and enterprise contracts.

5. **AGPL is right. Don't second-guess it.** The n8n Sustainable Use License is more aggressive and generates more commercial friction, but also more community criticism. AGPL is the accepted, OSI-approved middle ground that Metabase, Plausible, and Grafana all use. Stick with it.

---

## Sources

- [GitLab FY2025 Annual Report](https://s204.q4cdn.com/984476563/files/doc_financials/2025/ar/GitLab-Annual-Report-FY25.pdf)
- [GitLab Revenue — MacroTrends](https://www.macrotrends.net/stocks/charts/GTLB/gitlab/revenue)
- [How GitLab Makes $500M — FourWeekMBA](https://fourweekmba.com/how-does-gitlab-make-money/)
- [HashiCorp Adopts Business Source License — HashiCorp Blog](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license)
- [HashiCorp BSL Changes — The Register](https://www.theregister.com/2023/08/11/hashicorp_bsl_licence/)
- [HashiCorp BSL — Infisical Analysis](https://infisical.com/blog/hashicorp-new-bsl-license)
- [Metabase Pricing](https://www.metabase.com/pricing/)
- [Supabase Revenue — Sacra](https://sacra.com/c/supabase/)
- [Supabase $200M Round — SiliconANGLE](https://siliconangle.com/2025/04/22/supabase-reels-200m-open-source-relational-database/)
- [Plausible — How We Built a $1M ARR Open Source SaaS](https://plausible.io/blog/open-source-saas)
- [Cal.com Revenue — Latka](https://getlatka.com/companies/calcom)
- [PostHog Revenue — Sacra](https://sacra.com/c/posthog/)
- [PostHog Open Source Business Models](https://posthog.com/blog/open-source-business-models)
- [PostHog $70M Series D — Crunchbase](https://news.crunchbase.com/ai/startup-posthog-tweet-funding-round-stripe/)
- [n8n Revenue — Sacra](https://sacra.com/c/n8n/)
- [n8n $180M Series C — TechFundingNews](https://techfundingnews.com/n8n-raises-180m-series-c-2-5-billion-valuation-automation-ai/)
- [n8n Sustainable Use License](https://docs.n8n.io/sustainable-use-license/)
- [Airbyte Business Breakdown — Contrary Research](https://research.contrary.com/company/airbyte)
- [Grafana Relicensing to AGPLv3 — Grafana Labs Blog](https://grafana.com/blog/2021/04/20/grafana-loki-tempo-relicensing-to-agplv3/)
- [Grafana CEO Q&A on Licensing](https://grafana.com/blog/2021/04/20/qa-with-our-ceo-on-relicensing/)
- [Open Source Conversion Rates — GetMonetizely](https://www.getmonetizely.com/articles/whats-the-optimal-conversion-rate-from-free-to-paid-in-open-source-saas)
- [CLM Pricing Exposed — Concord](https://www.concord.app/blog/clm-pricing-exposed-real-costs-hidden-fees-vendor-quotes)
- [Lago Blog on AGPLv3 Choice](https://getlago.com/blog/open-source-licensing-and-why-lago-chose-agplv3)
- [Open Core Model — Wikipedia](https://en.wikipedia.org/wiki/Open-core_model)
- [DocuSeal Pricing](https://www.docuseal.com/pricing)
- [Documenso Pricing](https://documenso.com/pricing)
- [CLM Software Pricing Guide — Zefort](https://zefort.com/blog/contract-management-software-pricing-explained-what-buyers-need-to-know/)
- [B2B SaaS Pricing Benchmarks 2024 — PricingI/O](https://www.pricingio.com/2024-b2b-saas-pricing/)
