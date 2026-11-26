import Link from "next/link";
import { HeroPreview } from "@/components/landing/hero-preview";
import { Brand } from "@/components/shell/brand";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { ButtonLink, Mono } from "@/components/ui/core";
import { StrategyBadge } from "@/components/domain/strategy-bits";
import { STRATEGY_CONTEXT, VAULT_UI_ON } from "@/lib/strategy-context";
import { IconArrowRight, IconArrowUpRight, IconCheck, IconMinus } from "@/components/ui/icons";
import { CURATED, modeLabel, templateAvailability, templateFacts } from "@/lib/strategy";
import { TARGET_KIND, explorerTxUrl, xLayerMainnet, xLayerTestnet } from "@/lib/chains";
import { BRAND } from "@/lib/brand";
import { CONNECT, CONNECT_STATUS_LABEL, connectVerified } from "@/lib/connect";
import { EVIDENCE } from "@/lib/evidence";
import { EXPANSION, V2_SWAP_LABEL } from "@/lib/expansion";
import { TAPEOUT } from "@/lib/tapeout";
import { shortAddress, shortHash } from "@/lib/format";
import { RUNTIME } from "@/services/runtime";

// Only areas with something real behind them in this build.
const NAV = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/strategies", label: "Strategies" },
  { href: "/discover", label: "Discover" },
  { href: "/studio", label: "Studio" },
  ...(connectVerified() ? [{ href: "/connect", label: "Connect" }] : []),
  { href: "#evidence", label: "Evidence" },
];

/** Shown on the landing from the same derivation Discover uses, so a label here can never disagree with the app. */
const LANDING_CONTEXT = STRATEGY_CONTEXT;

export default function LandingPage() {
  const llm = CONNECT.llm.status === "ok" ? CONNECT.llm.value : null;
  // The two lists under "Availability" are derived, so they cannot promise what this build does not do.
  const adopt = (profile: string) => {
    const entry = CURATED.find((item) => item.template.profile === profile);
    return entry ? templateAvailability(entry.template, LANDING_CONTEXT) : null;
  };
  const debt = adopt("debt-protection-v1");
  const swap = adopt("restricted-swap-v2");
  const live = RUNTIME.manifest.state === "deployed" && TARGET_KIND === "testnet" && !RUNTIME.fixture;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-10">
            <Brand />
            <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="rounded text-[0.9375rem] text-muted hover:text-fg">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <ButtonLink href="/portfolio" size="sm" className="h-10 px-4">
              Launch app
            </ButtonLink>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:pt-24 lg:pb-28">
          <div className="min-w-0">
            <p className="inline-flex min-h-8 items-center gap-2 rounded-full border border-line-strong px-3 py-1 text-xs font-medium text-muted" data-testid="hero-availability">
              <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
              On X Layer testnet · test tokens only
            </p>
            <p className="eyebrow mt-6" data-testid="positioning">
              {BRAND.name} — {BRAND.positioning}
            </p>
            <h1 className="display mt-3" data-testid="headline">
              Put your portfolio
              <br />
              on autopilot.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted sm:text-xl" data-testid="supporting">
              {BRAND.supporting}
            </p>
            <div className="mt-9 flex flex-col gap-3 xs:flex-row">
              <ButtonLink href="/strategies#create" size="lg" data-testid="cta-create">
                Create a strategy <IconArrowRight size={18} />
              </ButtonLink>
              <ButtonLink href="/discover" size="lg" variant="secondary" data-testid="cta-explore">
                Explore strategies
              </ButtonLink>
            </div>
            <p className="mt-7 text-base font-medium tracking-tight" data-testid="tagline">
              {BRAND.tagline}
            </p>
            <p className="mt-2 max-w-md text-[0.8125rem] text-faint">Experimental software. Not audited. Nothing on this site is an offer, a yield promise or financial advice.</p>
          </div>
          <div className="min-w-0">
            <HeroPreview />
          </div>
        </section>

        {/* Pillars */}
        <section className="border-t border-line bg-subtle">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
            <p className="eyebrow">Strategies are the product</p>
            <h2 className="headline mt-3 max-w-3xl">Lending, borrowing and swaps are the instruments. A strategy is what plays them.</h2>
            <div className="mt-10 grid gap-4 lg:grid-cols-3" data-testid="pillars">
              <Pillar name="Automate" pitch="Give a rule or your own agent a bounded job on your account: one operation, a budget, an expiry." points={["The account contract enforces every limit", "An operator can never withdraw", "One emergency stop ends it all"]} href="/strategies" cta="Open Strategies" />
              <Pillar name="Discover" pitch="Start from a template instead of a blank page. Inspect exactly what it permits before you adopt it." points={["Curated, genuine templates only", "Bound to contracts deployed on testnet", "No invented returns, TVL or user counts"]} href="/discover" cta="Explore strategies" />
              <Pillar name="Build" pitch="Make products for others: a strategy template, a lending market with its own rules, a policy circuit." points={["Export a strategy as JSON with a content hash", "Launch an isolated lending market", "Importing never grants authority"]} href="/studio" cta="Open Studio" />
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="eyebrow">Why</p>
          <h2 className="headline mt-3 max-w-3xl">Less to watch. Nothing handed over.</h2>
          <ul className="mt-10 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-4" data-testid="benefits">
            <Benefit title="Less manual work" body="A strategy repays debt or makes a bounded swap when its conditions hold, so you are not the one refreshing a position at night." />
            <Benefit title="Controlled AI permissions" body="An agent gets a grant, not a key: which operation, how much per call and in total, until when. Outside it, the account refuses." />
            <Benefit title="Unified management" body="Positions, active strategies, remaining budgets, recent operations and the stop button are on one page: Portfolio." />
            <Benefit title="Reusable strategies" body="A strategy is a small versioned document. Export it, share it, import it elsewhere. Each owner still signs their own grant." />
          </ul>
        </section>

        {/* Discovery preview: the real templates */}
        <section className="border-t border-line bg-subtle">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Discover</p>
                <h2 className="headline mt-3 max-w-2xl">The strategies you can adopt today.</h2>
              </div>
              <ButtonLink href="/discover" variant="secondary">
                See them on Discover <IconArrowRight size={16} />
              </ButtonLink>
            </div>
            <ul className="mt-10 grid gap-4 lg:grid-cols-2" data-testid="landing-templates">
              {CURATED.map((entry) => {
                const availability = templateAvailability(entry.template, LANDING_CONTEXT);
                const facts = templateFacts(entry.template);
                return (
                  <li key={entry.hash} className="flex flex-col rounded-3xl border border-line bg-surface p-6 sm:p-8" data-landing-template={entry.template.profile} data-availability={availability.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StrategyBadge status={availability.status} />
                      <span className="text-xs text-muted">{modeLabel(entry.template)}</span>
                    </div>
                    <h3 className="mt-4 text-2xl font-semibold tracking-tight">{entry.template.name}</h3>
                    <p className="mt-2 flex-1 text-muted">{entry.template.description}</p>
                    <dl className="num mt-5 divide-y divide-line text-sm">
                      {facts
                        .filter((fact) => fact.label === "Budget" || fact.label === "Grant lifetime")
                        .map((fact) => (
                          <div key={fact.label} className="flex items-baseline justify-between gap-4 py-2">
                            <dt className="text-muted">{fact.label}</dt>
                            <dd className="text-right">{fact.value}</dd>
                          </div>
                        ))}
                    </dl>
                  </li>
                );
              })}
            </ul>
            <p className="mt-5 max-w-2xl text-sm text-faint">That is the whole catalogue: two templates, both on test tokens. No performance figures exist for them and none are shown.</p>
          </div>
        </section>

        {/* Bring your own AI */}
        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1fr_1fr] lg:gap-16" data-testid="landing-byo">
          <div>
            <p className="eyebrow">Bring your own AI</p>
            <h2 className="headline mt-3">Your model. Your machine. A grant instead of a key.</h2>
            <p className="mt-5 max-w-lg text-muted">
              Sentinel Connect is an MCP server you run next to any MCP-capable model. The model reads your account, simulates, and can execute the one operation you granted. Peridot runs no model and hosts none of this.
            </p>
            <div className="mt-7 flex flex-col gap-3 xs:flex-row">
              <ButtonLink href="/connect#onboarding">
                Connect your own AI <IconArrowRight size={16} />
              </ButtonLink>
              {llm ? (
                <ButtonLink href="/connect#llm-session" variant="secondary" data-testid="landing-llm-link">
                  See the recorded session
                </ButtonLink>
              ) : null}
            </div>
          </div>
          <ol className="divide-y divide-line rounded-3xl border border-line bg-surface">
            <Flow n="1" title="You grant" body="As the owner you sign a grant for an operator address: one operation, a per-call and a total limit, an expiry." />
            <Flow n="2" title="Your agent proposes" body="Through typed tools it reads, quotes and simulates. No tool takes calldata, a recipient or another account." />
            <Flow n="3" title="The account decides" body="The account contract checks the grant and the policy circuit on every call. What is outside the grant reverts." />
            {llm ? (
              <li className="p-5 text-sm sm:p-6" data-testid="landing-llm">
                <span className="inline-flex min-h-6 items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">Recorded on testnet · one session</span>
                <p className="mt-2.5 text-muted">
                  In one recorded session a language model ({llm.model}) chose a swap inside its grant and it settled on X Layer testnet through the mock venue; its borrow attempt was refused by the account. A single session started by a person, not continuous monitoring.
                </p>
              </li>
            ) : null}
          </ol>
        </section>

        {/* Studio */}
        <section className="mx-auto max-w-7xl px-5 pb-16 sm:px-8 sm:pb-24">
          <div className="rounded-3xl bg-inverse px-6 py-12 text-on-inverse sm:px-12 sm:py-16" data-testid="landing-studio">
            <p className="text-sm font-medium opacity-70">Studio, for builders</p>
            <h2 className="headline mt-3 max-w-2xl">Create financial products others can adopt.</h2>
            <p className="mt-4 max-w-xl text-lg opacity-70">Publish a strategy template, or launch an isolated lending market with its own limits and policy circuit. Studio shows the exact call before anything is signed. Managed vaults are on the roadmap.</p>
            <div className="mt-8 flex flex-col gap-3 xs:flex-row">
              <Link href="/studio" className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-bg px-7 font-medium text-fg hover:opacity-90">
                Open Studio <IconArrowRight size={18} />
              </Link>
              <Link href="/studio/create" className="inline-flex h-13 items-center justify-center rounded-full border border-on-inverse px-7 font-medium hover:opacity-80">
                Build a market
              </Link>
            </div>
          </div>
        </section>

        {/* Mechanism */}
        <section className="border-t border-line bg-subtle">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24" data-testid="landing-mechanism">
            <p className="eyebrow">How authorisation works</p>
            <h2 className="headline mt-3 max-w-3xl">Agent proposes. Contract authorises. Protocol settles.</h2>
            <p className="mt-5 max-w-2xl text-muted">Rules are not checked by a server you have to trust. A rule compiles to a TapeOut-format circuit, and the contracts evaluate it inside the transaction that would increase your risk.</p>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3">
              <Step n="01" title="Define" body="A rule is a small typed policy: a loan-to-value cap, the actions an account may take, a price limit on a swap. No arbitrary code." />
              <Step n="02" title="Compile" body="The policy compiles to a stateless NAND circuit with a deterministic hash. The sample market policy is 63 gates, the sample account policy 87." />
              <Step n="03" title="Enforce" body="Every risk-increasing transaction is checked inside the contracts against the circuits. Repayment and safe exits are never blocked by a policy." />
            </ol>
            <div className="mt-7 flex flex-col gap-3 xs:flex-row">
              <ButtonLink href="/circuits" variant="secondary">
                Inspect the circuits <IconArrowRight size={16} />
              </ButtonLink>
              <ButtonLink href="#evidence" variant="ghost">
                What has been verified
              </ButtonLink>
            </div>
          </div>
        </section>

        {/* Availability and limits */}
        <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24" data-testid="landing-limits">
          <p className="eyebrow">Availability</p>
          <h2 className="headline mt-3 max-w-3xl">Testnet only, and what that means.</h2>
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            <LimitList
              title="What works today"
              tone="done"
              items={[
                ...(live ? ["X Layer testnet (chain 1952): lending markets, Sentinel accounts, policies, operator grants and the emergency stop, from your own wallet.", "Creating a lending market with its own policy circuit in Studio."] : []),
                ...(debt?.canSign ? ["Adopting the debt-protection strategy: you review the exact transactions and sign them yourself."] : []),
                ...(swap?.canSign ? ["Adopting the restricted agent swap on a Sentinel v2 account, through a mock swap venue."] : []),
                ...(connectVerified() ? ["Your own agent over MCP, executing one granted operation. Recorded on testnet."] : []),
                ...(!live ? ["This build shows labelled example data: it is not reading a deployment, and it sends nothing."] : []),
              ]}
            />
            <LimitList
              title="Limits you should know"
              tone="pending"
              items={[
                "Test tokens with no value, a mock price feed and a mock swap venue. No real exchange is connected on testnet.",
                "On testnet, policy circuits run on a development reference processor, not on TapeOut.",
                "Adopting a strategy authorises an operator you choose. Peridot runs no service on testnet that acts for you, so nothing happens until your operator acts.",
                `${swap?.canSign ? "Sentinel v2 swaps go through a mock venue only." : "Sentinel v2 (swaps) can be read in this app but not signed from it."} ${VAULT_UI_ON ? "A vault account deposits into a mock vault that pays no yield." : "Vaults are not available."} Liquidity positions and a hosted AI are not available.`,
                "Not audited. No mainnet deployment holds funds. Automation is not a guarantee: prices, liquidity and the network can prevent an action in time.",
              ]}
            />
          </div>
        </section>

        {/* Evidence and technology: detailed status lives here, below the product story */}
        <section id="evidence" className="scroll-mt-20 border-t border-line bg-subtle">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16" data-testid="landing-evidence">
            <div>
              <p className="eyebrow">Evidence and technology</p>
              <h2 className="headline mt-3">What is real today, and what is not.</h2>
              <p className="mt-5 max-w-md text-muted">
                Peridot Sentinel is an entry in the X Layer TapeOut Accelerate hackathon. Each item on the right is derived from a recorded transaction, a read of a public chain or the deployment manifest in this build.
              </p>
              <p className="mt-4 max-w-md text-sm text-faint">Participation only. Peridot Sentinel is not sponsored, endorsed or audited by OKX, X Layer or TapeOut.</p>
              <div className="mt-7 flex flex-col gap-3 xs:flex-row">
                <ButtonLink href="/circuits" variant="secondary">
                  Circuits and native evaluation
                </ButtonLink>
                <ButtonLink href="/activity" variant="ghost">
                  Recorded activity
                </ButtonLink>
              </div>
            </div>
            <StatusList />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Brand />
            <p className="mt-4 max-w-sm text-sm text-muted">{BRAND.tagline}</p>
            <p className="mt-4 max-w-sm text-xs text-faint">Experimental software on a test network. Test tokens have no value. No audit has been performed. Not available as a financial product.</p>
          </div>
          <FooterColumn title="Product" links={[...NAV.filter((item) => !item.href.startsWith("#")), { href: "/markets?view=earn", label: "Earn" }, { href: "/markets?view=borrow", label: "Borrow" }, { href: "/circuits", label: "Circuits" }].map((item) => ({ ...item, external: false }))} />
          <FooterColumn
            title="Network"
            links={[
              { href: xLayerTestnet.blockExplorers.default.url, label: "X Layer testnet explorer", external: true },
              { href: xLayerMainnet.blockExplorers.default.url, label: "X Layer explorer", external: true },
              { href: "https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/about-xlayer", label: "X Layer developer docs", external: true },
              { href: "https://github.com/TapeOutProtocol/TAPs", label: "TapeOut TAP specifications", external: true },
            ]}
          />
        </div>
      </footer>
    </div>
  );
}

function Pillar({ name, pitch, points, href, cta }: { name: string; pitch: string; points: string[]; href: string; cta: string }) {
  return (
    <article className="flex flex-col rounded-3xl border border-line bg-surface p-6 sm:p-8" data-pillar={name}>
      <h3 className="text-3xl font-semibold tracking-tight sm:text-4xl">{name}</h3>
      <p className="mt-3 text-lg text-muted">{pitch}</p>
      <ul className="mt-6 flex-1 space-y-3">
        {points.map((point) => (
          <li key={point} className="flex gap-3 text-[0.9375rem]">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-raised">
              <IconCheck size={12} strokeWidth={2.6} />
            </span>
            {point}
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <ButtonLink href={href} variant="secondary">
          {cta} <IconArrowRight size={16} />
        </ButtonLink>
      </div>
    </article>
  );
}

function Benefit({ title, body }: { title: string; body: string }) {
  return (
    <li className="bg-bg p-6 sm:p-7">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2.5 text-[0.9375rem] text-muted">{body}</p>
    </li>
  );
}

function Flow({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="flex gap-4 p-5 sm:p-6">
      <span className="num grid size-8 shrink-0 place-items-center rounded-full bg-raised text-sm font-medium">{n}</span>
      <div>
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-[0.9375rem] text-muted">{body}</p>
      </div>
    </li>
  );
}

function LimitList({ title, items, tone }: { title: string; items: string[]; tone: "done" | "pending" }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      <ul className="mt-5 space-y-3.5 text-[0.9375rem]">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${tone === "done" ? "bg-success-soft text-success" : "bg-raised text-muted"}`}>{tone === "done" ? <IconCheck size={12} strokeWidth={2.6} /> : <IconMinus size={12} strokeWidth={2.6} />}</span>
            <span className={tone === "done" ? "" : "text-muted"}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="bg-bg p-6 sm:p-8">
      <div className="num font-mono text-sm text-faint">{n}</div>
      <h3 className="mt-8 text-2xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-3 text-[0.9375rem] text-muted">{body}</p>
    </li>
  );
}

type StatusTone = "done" | "simulated" | "pending" | "none";

/** Derived from the evidence files and the deployment manifest, so this section cannot drift from reality. */
function StatusList() {
  const sample = EVIDENCE.publicSample;
  const fork = EVIDENCE.forkSettlement;
  const deployed = RUNTIME.manifest.state === "deployed" && TARGET_KIND === "testnet";
  const testnetRepay = EVIDENCE.testnetAutoRepay;
  const testnetRepayUrl = testnetRepay.status === "ok" ? explorerTxUrl(testnetRepay.value.chainId, testnetRepay.value.hash) : null;
  const connectTxUrl = CONNECT.transcript.status === "ok" ? explorerTxUrl(CONNECT.transcript.value.chainId, CONNECT.transcript.value.step5.hash) : null;
  const publishedCircuits = TAPEOUT.status === "ok" ? TAPEOUT.value.circuits.filter((circuit) => circuit.publication.state === "published").length : 0;
  const rows: Array<{ tone: StatusTone; label: string; title: string; body: React.ReactNode }> = [
    sample.status === "ok"
      ? {
          tone: "done",
          label: "Public, read-only",
          title: "An existing TapeOut circuit evaluated on X Layer mainnet",
          body: (
            <>
              Processor <Mono>{shortAddress(sample.value.processor)}</Mono>, circuit {sample.value.circuitId}, block {Number(sample.value.block).toLocaleString("en-US")}. {sample.value.vectors.filter((vector) => vector.matches).length} of {sample.value.vectors.length} test inputs matched the reference model. This is not a Peridot circuit.
            </>
          ),
        }
      : { tone: "pending", label: "Not recorded", title: "Public TapeOut circuit evaluation", body: "No read-only mainnet evidence is bundled with this build." },
    fork.status === "ok"
      ? {
          tone: "simulated",
          label: "Fork simulation",
          title: "Peridot policies enforced by the real processor code",
          body: "On a local fork of X Layer mainnet, a market policy and an account policy were fabricated and enforced on a borrow, including one rejection by each. These are not public transactions.",
        }
      : { tone: "pending", label: "Not recorded", title: "Peridot policies on the real processor code", body: "No fork evidence is bundled with this build." },
    deployed
      ? {
          tone: "done",
          label: "Testnet",
          title: "Contracts deployed on X Layer testnet",
          body: (
            <>
              Chain 1952, test profile with mock tokens and a mock price feed. Policies are evaluated by a development reference processor, not by TapeOut.
              {testnetRepay.status === "ok" && testnetRepayUrl ? (
                <>
                  {" "}
                  A separate repay-only operator has executed one automated repayment there:{" "}
                  <a href={testnetRepayUrl} target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-4">
                    transaction {shortHash(testnetRepay.value.hash)}
                  </a>
                  .
                </>
              ) : null}
            </>
          ),
        }
      : { tone: "pending", label: "Not deployed", title: "X Layer testnet deployment", body: "No Peridot contract is deployed on chain 1952 yet. The app shows clearly labelled example data and keeps writes disabled." },
    // Sentinel Connect: listed only while the build holds the recorded public testnet run.
    ...(connectVerified() && CONNECT.transcript.status === "ok" && connectTxUrl
      ? [
          {
            tone: "done" as const,
            label: CONNECT_STATUS_LABEL,
            title: "Sentinel Connect: an external agent executed one restricted operation",
            body: (
              <>
                A scripted MCP client, in its own process, read the account, simulated, and repaid debt under a repay-only grant:{" "}
                <a href={connectTxUrl} target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-4">
                  transaction {shortHash(CONNECT.transcript.value.step5.hash)}
                </a>
                . Its attempt to borrow was refused by the account contract in a simulation. Agent-directed: it acts when called, and watches nothing on its own.{" "}
                <Link href="/connect" className="font-medium text-fg underline underline-offset-4">
                  How it works
                </Link>
              </>
            ),
          },
        ]
      : []),
    // Sentinel v2: listed only with the public manifest and the recorded operator swap.
    ...(TARGET_KIND === "testnet" && EXPANSION.manifest.status === "ok" && EXPANSION.demo.status === "ok" && EXPANSION.demo.value.operatorSwap
      ? [
          {
            tone: "done" as const,
            label: "Testnet · mock venue",
            title: "Sentinel v2: an operator swapped inside a typed, budgeted grant",
            body: (
              <>
                {V2_SWAP_LABEL}. On testnet a 101 bps swap was mined and reverted by the execution policy, and a 100 bps swap by the operator settled to the account.{" "}
                <Link href="/trade" className="font-medium text-fg underline underline-offset-4">
                  See the receipts
                </Link>
              </>
            ),
          },
        ]
      : []),
    {
      tone: publishedCircuits > 0 ? ("done" as const) : ("pending" as const),
      label: publishedCircuits > 0 ? "Public mainnet" : "Not yet published",
      title: "Peridot's own circuits on the TapeOut processor",
      body:
        publishedCircuits > 0
          ? `${publishedCircuits} of Peridot's policy circuits are published on X Layer mainnet and can be evaluated read-only from the Circuits page. That is evidence of the circuits, not enforcement: no mainnet account or market is bound to them.`
          : "Peridot's three policy circuits have been rehearsed on a mainnet fork and are not published on X Layer mainnet yet. The Circuits page evaluates each one natively, read-only, once it is.",
    },
    { tone: "none", label: "None", title: "Mainnet funds", body: "No Peridot contract holds funds on X Layer mainnet. Nothing here has been audited." },
  ];
  const toneClass: Record<StatusTone, string> = {
    done: "bg-success-soft text-success",
    simulated: "bg-warning-soft text-warning",
    pending: "bg-raised text-muted",
    none: "bg-raised text-muted",
  };
  return (
    <ul className="divide-y divide-line rounded-3xl border border-line bg-surface">
      {rows.map((row) => (
        <li key={row.title} className="p-5 sm:p-6">
          <span className={`inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass[row.tone]}`}>{row.label}</span>
          <h3 className="mt-3 text-base font-semibold tracking-tight">{row.title}</h3>
          <p className="mt-1.5 text-sm text-muted">{row.body}</p>
        </li>
      ))}
    </ul>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<{ href: string; label: string; external: boolean }> }) {
  return (
    <div>
      <h2 className="eyebrow">{title}</h2>
      <ul className="mt-4 space-y-1">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded text-sm text-muted hover:text-fg">
                {link.label} <IconArrowUpRight size={13} />
              </a>
            ) : (
              <Link href={link.href} className="inline-flex min-h-9 items-center rounded text-sm text-muted hover:text-fg">
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
