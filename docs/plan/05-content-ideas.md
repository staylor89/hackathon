# 05: Content Ideas — Towers (AWS Services) and Attackers (Tortoises)

A menu, not a backlog. The MVP is still **AWS Shield vs the DDoS Tortoise**; everything here is optional content we pull from once the core loop holds. Each entry says what it does mechanically, which real AWS behaviour or real attack it maps to, and roughly what it costs us to build against the current code.

Two rules kept every idea below honest, and they should gate anything we add later:

1. **The joke has to map to real behaviour.** S3 Glacier slows things down because retrieval genuinely takes hours; GuardDuty finds cryptominers because that's its flagship finding. An infra audience will spot a mapping we invented for convenience, and the ones that land are the ones that are true.
2. **Every addition has to change a decision.** A second tower that is "Shield but 20% better" is worth nothing in a demo. A tower is worth building if it makes the player place things differently; an enemy is worth building if it punishes a defence that was previously fine.

## Implementation cost tiers

Referenced throughout as **T0/T1/T2** so we can pick by remaining time rather than by enthusiasm.

| Tier | What it takes | Realistic at |
|---|---|---|
| **T0** | Stats only. A new entry in `TOWERS`/`ENEMIES` plus a placeholder texture. No engine change | Any time, including during the freeze |
| **T1** | One new config field plus a handful of lines in an existing update loop (a multiplier, a timer, an on-death hook) | Sprint 2 or the balance window |
| **T2** | New engine capability: path manipulation, holding enemies, targetability rules, tower state | Only if we are ahead at the checkpoint, and only one of them |

## Towers: AWS services

Grouped by the role they play, because role coverage is what makes a tower roster interesting. We currently have exactly one role filled (single-target damage).

### Damage

| Tower | Mechanic | Real behaviour it maps to | Tier |
|---|---|---|---|
| **AWS Shield** | Baseline single-target DPS, cheap, fast, targets furthest along | Managed DDoS protection: always on, absorbs volume | shipped |
| **AWS Lambda** | Long cooldown, then a burst of many projectiles at once. First shot after idling suffers a **cold start** delay | Bursty, event-driven, scales instantly, and yes, cold starts | T1 |
| **AWS WAF** | Deals no ordinary damage. Instantly deletes enemies whose type is in its ruleset, ignores everything else | Rule-matched request blocking: devastating against a signature it knows, blind to anything it doesn't | T1 |
| **CloudFront** | Placed near the ingress. A share of arriving traffic is a "cache hit" and never enters the region at all; each hit pays a small budget rebate | Edge caching absorbs load before it reaches the origin, and it's cheaper per request than origin traffic | T1 |
| **Amazon Bedrock** | Auto-targets the highest-threat enemy on the map regardless of range, with a small chance of firing at nothing | Model-driven anomaly detection, plus the hallucination tax | T1 |

`AWS WAF` is the single best-value addition on this list. It's a genuine strategic choice rather than more damage, it needs one field (`instantKillTypes`), and it forces us to add a second enemy type for it to counter, which is exactly the direction we want the content to grow.

### Control

The roster's biggest gap. A slow tower alone would roughly double the depth of the current game.

| Tower | Mechanic | Real behaviour it maps to | Tier |
|---|---|---|---|
| **S3 Glacier** | No damage. Enemies inside the radius move at a fraction of their speed | Retrieval takes hours. The joke writes itself and the mechanic is a two-line multiplier | T1 |
| **Amazon SQS** | Captures up to N enemies in range and holds them, releasing one at a time on an interval. Overflow spills past it | A queue decoupling a burst producer from a slow consumer, with a dead-letter queue for the overflow | T2 |
| **Elastic Load Balancer** | Knockback. Shoves enemies back along the trench toward the ingress | Traffic redistribution: it doesn't destroy load, it moves it somewhere else | T2 |
| **Security Group** | A barrier placed **on** the trench rather than beside it. Has HP, blocks the path until enemies chew through it, then needs rebuying | Deny-by-default ingress rules, and the recurring lesson about `0.0.0.0/0` | T2 |
| **AWS IAM** | Explicit deny: instantly removes one enemy, however tough, on a very long cooldown. Small chance of also disabling one of our own towers for a few seconds | An explicit deny beats every allow, and misconfigured policies take down the wrong thing | T1 |

Glacier is the cheapest real depth we can buy. Slow plus damage is the foundational tower-defence interaction, and it makes placement matter: the player starts thinking about where the trench bends rather than just how many Shields they can afford.

### Support and economy

| Tower | Mechanic | Real behaviour it maps to | Tier |
|---|---|---|---|
| **Auto Scaling Group** | Aura that raises the fire rate of adjacent towers, scaled by how many enemies are currently in range, after a warm-up delay | Capacity follows load, and it is always a little too late | T1 |
| **Amazon GuardDuty** | No damage. Reveals stealthed enemies (making them targetable) and flags everything in range so it takes extra damage | Detection, not prevention: it tells you what's happening and something else has to act | T1 |
| **Amazon CloudWatch** | Extends the range of nearby towers. Costs budget every wave to run | Observability makes everything else more effective and the bill is genuinely startling | T1 |
| **AWS Backup** | No damage. Slowly restores origin integrity, with a hard cap per run | Restore from snapshot, assuming anybody ever tested the restore | T1 |
| **Spot Instances** | Half the cost of an equivalent tower, but it can be reclaimed mid-wave and vanish, with a two-second warning first | Spot interruption notices, exactly as advertised | T1 |
| **Trusted Advisor** | No combat effect. Pays a budget dividend at the end of each wave | Cost-optimisation recommendations nobody reads until the bill lands | T0 |

`Spot Instances` is the most demo-friendly item on the page: it's cheap to build (a per-wave interruption roll), it generates a visible dramatic moment, and every engineer watching understands the trade immediately.

### Structural

| Tower | Mechanic | Real behaviour it maps to | Tier |
|---|---|---|---|
| **Amazon EKS** | Spawner. Periodically emits short-lived "pods" that walk into the trench and body-block enemies, dying constantly | Pods are cattle, and the churn is the point | T2 |
| **Route 53** | Sinkhole. Teleports a single enemy back to the ingress on a long cooldown | DNS blackholing, and the fact that the fix for everything is eventually DNS | T2 |
| **Systems Manager Patch Manager** | Permanently removes the exploit-based immunity from enemies that carry one (see Zero-Day and Log4Shell below) | Patching closes the vulnerability rather than filtering the traffic | T1 |

## Attackers: tortoises

Naming convention worth holding to: **`<attack> <turtle species or shell word>`**. It keeps the puns generative instead of ad hoc. Useful vocabulary: terrapin, snapper, loggerhead, leatherback, hatchling, carapace, plastron, scute, testudo, galápagos.

`Testudo` deserves special mention: the Roman shield-wall formation is literally named "tortoise", which is a free gift to a game about shields and armour.

### Volume pressure

| Enemy | Mechanic | What it is | Counter | Tier |
|---|---|---|---|---|
| **DDoS Tortoise** | Fast, weak, arrives in bursts. Threat comes from count, not stats | Volumetric DDoS | Shield, CloudFront | shipped |
| **Botnet Brood** | Very fast hatchlings in large numbers, near-zero HP, tiny bounty | Credential stuffing from a botnet | WAF rate rules, splash damage | T0 |
| **Crawler Carapace** | Endless low-threat trickle that never stops between waves. Costs nothing to leak but drains attention | AI scrapers ignoring `robots.txt` | CloudFront, WAF bot control | T1 |
| **Thundering Herd** | A wave modifier rather than an enemy: the entire wave spawns simultaneously | Cache stampede after a mass expiry | Glacier, SQS | T1 |

### Durability pressure

| Enemy | Mechanic | What it is | Counter | Tier |
|---|---|---|---|---|
| **Testudo Formation** | Marches as a tight group and takes flat reduced damage while grouped. Breaking the formation removes the reduction | A shield wall; conceptually, coordinated traffic that looks legitimate in aggregate | Splash damage, Lambda bursts | T1 |
| **Zero-Day Leatherback** | Immune to WAF and every signature-based tower. Only raw damage works | A zero-day: no rule exists yet because nobody has seen it | Shield, Patch Manager | T1 |
| **Leaky Loggerhead** | Starts weak and **gains HP continuously** as it walks. Kill it early or it becomes unkillable | A memory leak | Front-loaded damage near the ingress | T1 |
| **Slowloris Tortoise** | Extremely slow, enormous HP, and while alive it holds connections open: towers in range fire more slowly | Slowloris, which is already a slowness-themed attack | Burst damage, high single-target DPS | T1 |

`Leaky Loggerhead` is my favourite of these to actually build. The mechanic is one line (`hp += growth * dt`), and it completely changes where players put towers: suddenly the ingress end of the trench matters more than the origin end.

### Economic pressure

| Enemy | Mechanic | What it is | Counter | Tier |
|---|---|---|---|---|
| **Coinshell Tortoise** | Deals no integrity damage. Drains budget continuously while alive, and leaking it costs nothing | Cryptomining on compromised instances, GuardDuty's signature finding | GuardDuty, fast kills | T1 |
| **Lockjaw Terrapin** | On reaching a tower, encrypts it: disabled until a ransom is paid in budget or a timer expires | Ransomware | AWS Backup, keeping it away from tower clusters | T2 |
| **Bill Shock Behemoth** | Slow, huge, and drains budget in proportion to its remaining HP. Leaking it is survivable; letting it live is not | The month-end invoice after an unnoticed misconfiguration | Trusted Advisor, focused fire | T1 |

An economic enemy is worth building precisely because it creates a second failure mode. Right now the only way to lose is integrity reaching zero; "you're alive but broke and cannot place another tower" is a different and more interesting loss, and it makes the economy towers earn their slots.

### Structural pressure

These are the ones that mess with the rules. Pick at most one; each is a T2 for a reason.

| Enemy | Mechanic | What it is | Counter | Tier |
|---|---|---|---|---|
| **Exfil Terrapin** | Spawns **at the origin** and walks toward the ingress. If it escapes, we lose integrity | Data exfiltration is outbound, so the enemy runs the map backwards | GuardDuty, egress filtering | T2 |
| **Trojan Tortoise** | Untargetable until revealed. Renders as legitimate traffic and walks straight through undamaged | An insider threat or a compromised credential | GuardDuty (the reveal is its whole purpose) | T2 |
| **Retry Terrapin** | On death, respawns once at the ingress after a backoff delay that lengthens each time | A retry storm with exponential backoff | Nothing special; it's a tempo tax | T1 |
| **Shellshock Tortoise** | On death, splits into several smaller tortoises | Shellshock, and a fork bomb, and a tortoise pun in one word | Splash damage | T1 |
| **Amplishell** | Deals no damage itself. Buffs the speed and HP of every nearby enemy | DNS amplification | Priority targeting; kill it first | T1 |
| **Hijack Hardshell** | Shortens the route by skipping waypoints, bypassing part of our defence | BGP hijack | Route 53, defence in depth | T2 |
| **Expired Cert Snapper** | Not tied to waves. Fires on its own timer and disables every tower until dealt with | Certificate expiry: our most reliable self-inflicted outage | ACM auto-renewal as a tower | T1 |

`Exfil Terrapin` is the single strongest idea in this document from a "judges remember it" standpoint, and it's also the most likely to eat an hour. If we build it, it should be the only T2 we attempt, and it needs its own reversed waypoint array rather than a general-purpose direction system.

## The counter matrix

The point of a roster is that no single defence answers everything. This is the shape we want, and it falls out of picking one tower from each role group:

| | Shield | WAF | Glacier | GuardDuty | Splash (Lambda) |
|---|---|---|---|---|---|
| **DDoS Tortoise** | ✅ | ✅ | ⚠️ helps | ❌ | ✅ |
| **Zero-Day Leatherback** | ✅ | ❌ immune | ⚠️ helps | ⚠️ amplifies | ✅ |
| **Testudo Formation** | ❌ | ❌ | ⚠️ helps | ⚠️ amplifies | ✅ |
| **Coinshell Tortoise** | ⚠️ too slow | ❌ | ❌ | ✅ | ✅ |
| **Trojan Tortoise** | ❌ can't target | ❌ | ❌ | ✅ required | ❌ |
| **Leaky Loggerhead** | ✅ if early | ✅ | ✅ | ✅ | ✅ |

Two things to preserve as we add content: no column is ✅ everywhere (no tower is strictly correct), and no row is ❌ everywhere (nothing is unanswerable).

## Recommended shortlist for the jam

If we get one content window, this is the set with the best depth-per-minute, and it is deliberately small:

**Towers:** `S3 Glacier` (slow, T1) and `AWS WAF` (hard counter, T1). Damage plus slow plus counter is the classic tower-defence triangle, and both are multipliers on code we already have.

**Enemies:** `Testudo Formation` (armoured, T1) and `Coinshell Tortoise` (budget drain, T1). The first makes damage-only defences fail, the second introduces the second loss condition.

**Cheap crowd-pleaser if there's slack:** `Spot Instances` (T1). One interruption roll per wave, and the reaction from the room is worth more than the code.

That's four entries, two new config fields each at most, and it turns a one-tower shooting gallery into a game with actual decisions. Everything else on this page is Sunday material or pitch fodder for "here's where it goes next", which is a perfectly good use for it.

## Config fields these ideas need

Additive changes to the interfaces in [01-contracts.md](./01-contracts.md), all optional so existing entries keep typechecking. Adding an optional field is allowed after the freeze; reshaping an existing one is not.

```ts
export interface TowerConfig {
    // ... existing fields
    role?: 'damage' | 'slow' | 'buff' | 'economy' | 'barrier';
    instantKillTypes?: EnemyType[];   // WAF ruleset
    slowFactor?: number;              // Glacier: 0.4 = 40% speed
    slowRadius?: number;
    splashRadius?: number;            // Lambda, anti-formation
    burstCount?: number;              // Lambda: projectiles per volley
    warmupMs?: number;                // Lambda cold start, ASG ramp
    buffFireRateMult?: number;        // ASG
    buffRangeAdd?: number;            // CloudWatch
    buffRadius?: number;
    revealsStealth?: boolean;         // GuardDuty
    damageTakenMult?: number;         // GuardDuty flagging
    incomePerWave?: number;           // Trusted Advisor
    upkeepPerWave?: number;           // CloudWatch
    interruptChancePerWave?: number;  // Spot
}

export interface EnemyConfig {
    // ... existing fields
    armour?: number;                  // flat reduction, Testudo
    armourNeedsGroup?: boolean;       // only while formed up
    hpGrowthPerSec?: number;          // Leaky Loggerhead
    budgetDrainPerSec?: number;       // Coinshell, Bill Shock
    stealth?: boolean;                // Trojan, needs revealsStealth
    immuneToRoles?: TowerConfig['role'][];  // Zero-Day vs signature towers
    onDeathSpawn?: { type: EnemyType; count: number };  // Shellshock
    respawnOnce?: boolean;            // Retry Terrapin
    respawnDelayMs?: number;
    auraSpeedMult?: number;           // Amplishell
    auraRadius?: number;
    reverse?: boolean;                // Exfil Terrapin
    towerDisableMs?: number;          // Lockjaw
}
```

## Deliberately not doing

Worth writing down so nobody re-proposes them at T+4:00.

**Tower upgrade trees.** Upgrades are a UI problem before they're a balance problem, and the UI is the part most likely to eat an hour. A second tower type demonstrates the same "the roster is data" pitch for a fraction of the work.

**Enemy types that need pathfinding.** Anything that burrows, flies over the trench, or picks its own route means abandoning the fixed waypoint list, which is the load-bearing simplification in the whole design.

**More than one T2.** Each of the structural enemies is a genuinely good idea and each one is a plausible way to spend the remaining time without shipping. One, chosen at the checkpoint, or none.

**Puns without mechanics.** There are a hundred more turtle jokes available (`Snapping Point`, `Galápagos Gateway`, `Plastron Panic`) and none of them are worth a texture unless they change how the player plays. Save them for tower and enemy flavour text, where they're free.
