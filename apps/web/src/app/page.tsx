import Link from "next/link";
import { HeroPreview } from "@/components/landing/hero-preview";
import { Brand } from "@/components/shell/brand";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { ButtonLink, Mono } from "@/components/ui/core";
import { IconArrowRight, IconArrowUpRight, IconCheck } from "@/components/ui/icons";
import { TARGET_KIND, xLayerMainnet, xLayerTestnet } from "@/lib/chains";
import { EVIDENCE } from "@/lib/evidence";
import { shortAddress } from "@/lib/format";
import { RUNTIME } from "@/services/runtime";

const NAV = [
  { href: "/sentinel", label: "Sentinel" },
  { href: "/markets", label: "Markets" },
  { href: "/studio", label: "Studio" },
  { href: "/circuits", label: "Circuits" },
];

export default function LandingPage() {
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
            <ButtonLink href="/sentinel" size="sm" className="h-10 px-4">
              Launch app
            </ButtonLink>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:pt-24 lg:pb-28">
          <div className="min-w-0">
            <p className="inline-flex min-h-8 items-center gap-2 rounded-full border border-line-strong px-3 py-1 text-xs font-medium text-muted">
              <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
              Experimental build on X Layer testnet
            </p>
            <h1 className="display mt-6">
              Your money.
              <br />
              Your rules.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted sm:text-xl">Programmable markets and intelligent financial accounts, powered by verifiable policies.</p>
            <div className="mt-9 flex flex-col gap-3 xs:flex-row">
              <ButtonLink href="/sentinel" size="lg">
                Launch Sentinel <IconArrowRight size={18} />
              </ButtonLink>
              <ButtonLink href="/studio/create" size="lg" variant="secondary">
                Build a market
              </ButtonLink>
            </div>
            <p className="mt-6 max-w-md text-[0.8125rem] text-faint">Test tokens only. Not audited. Nothing on this site is an offer, a yield promise or financial advice.</p>
          </div>
          <div className="min-w-0">
            <HeroPreview />
          </div>
        </section>

        {/* Two products */}
        <section className="border-t border-line bg-subtle">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
            <p className="eyebrow">Two products, one policy engine</p>
            <h2 className="headline mt-3 max-w-3xl">A market has rules. So do you. Both are enforced on the same transaction.</h2>
            <div className="mt-10 grid gap-4 lg:grid-cols-2">
              <ProductPanel
                eyebrow="For investors"
                name="Sentinel"
                pitch="Lend, borrow and manage positions from an account that follows your own policy."
                points={[
                  "Set a personal limit that is stricter than the market's.",
                  "Authorise automation that can repay debt and can never withdraw.",
                  "See exactly which rule allowed or stopped a transaction.",
                ]}
                href="/sentinel"
                cta="Launch Sentinel"
              />
              <ProductPanel
                eyebrow="For builders"
                name="Studio"
                pitch="Launch an isolated lending market with its own risk limits and policy circuit."
                points={[
                  "Isolated books: one market's losses never touch another.",
                  "Choose limits and a policy template, then preview the compiled circuit.",
                  "Borrowing opens only after liquidity is seeded and you activate.",
                ]}
                href="/studio/create"
                cta="Build a market"
              />
            </div>
          </div>
        </section>

        {/* Mechanism */}
        <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="eyebrow">How it works</p>
          <h2 className="headline mt-3 max-w-3xl">Agent proposes. Contract authorises. Protocol settles.</h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3">
            <Step n="01" title="Define" body="A rule is a small typed policy: a loan-to-value cap, the actions an account may take, a cash-reserve condition. No arbitrary code." />
            <Step
              n="02"
              title="Compile"
              body="The policy compiles to a stateless NAND circuit with a deterministic hash. The sample market policy is 63 gates, the sample account policy 87."
            />
            <Step n="03" title="Enforce" body="Every risk-increasing transaction is checked inside the contracts against both circuits. Repayment and safe exits are never blocked by a policy." />
          </ol>
        </section>

        {/* Integration status */}
        <section className="border-t border-line bg-subtle">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div>
              <p className="eyebrow">X Layer and TapeOut</p>
              <h2 className="headline mt-3">What is real today, and what is not.</h2>
              <p className="mt-5 max-w-md text-muted">
                Peridot Markets is an entry in the X Layer TapeOut Accelerate hackathon. Policies are evaluated as TapeOut-style circuits rather than trusted off-chain. Here is the exact status of each piece.
              </p>
              <p className="mt-4 max-w-md text-sm text-faint">Participation only. Peridot is not sponsored, endorsed or audited by OKX, X Layer or TapeOut.</p>
              <ButtonLink href="/circuits" variant="secondary" className="mt-7">
                See the evidence <IconArrowRight size={16} />
              </ButtonLink>
            </div>
            <StatusList />
          </div>
        </section>

        {/* Builder CTA */}
        <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="rounded-3xl bg-inverse px-6 py-12 text-on-inverse sm:px-12 sm:py-16">
            <h2 className="headline max-w-2xl">Bring a token. Define the rules. Open a market.</h2>
            <p className="mt-4 max-w-xl text-lg opacity-70">Studio walks through assets, risk limits and the policy circuit, and shows the exact call before anything is signed.</p>
            <div className="mt-8 flex flex-col gap-3 xs:flex-row">
              <Link href="/studio/create" className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-bg px-7 font-medium text-fg hover:opacity-90">
                Build a market <IconArrowRight size={18} />
              </Link>
              <Link href="/circuits" className="inline-flex h-13 items-center justify-center rounded-full border border-on-inverse px-7 font-medium hover:opacity-80">
                Browse policy circuits
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Brand />
            <p className="mt-4 max-w-sm text-sm text-muted">Build your market. Define your rules. Automate your finances.</p>
            <p className="mt-4 max-w-sm text-xs text-faint">Experimental software on a test network. Test tokens have no value. No audit has been performed. Not available as a financial product.</p>
          </div>
          <FooterColumn title="Product" links={NAV.map((item) => ({ ...item, external: false }))} />
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

function ProductPanel({ eyebrow, name, pitch, points, href, cta }: { eyebrow: string; name: string; pitch: string; points: string[]; href: string; cta: string }) {
  return (
    <article className="flex flex-col rounded-3xl border border-line bg-surface p-6 sm:p-9">
      <p className="eyebrow">{eyebrow}</p>
      <h3 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{name}</h3>
      <p className="mt-3 max-w-md text-lg text-muted">{pitch}</p>
      <ul className="mt-7 space-y-3.5">
        {points.map((point) => (
          <li key={point} className="flex gap-3 text-[0.9375rem]">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-raised">
              <IconCheck size={12} strokeWidth={2.6} />
            </span>
            {point}
          </li>
        ))}
      </ul>
      <div className="mt-9 pt-1 lg:mt-auto lg:pt-9">
        <ButtonLink href={href} variant="secondary">
          {cta} <IconArrowRight size={16} />
        </ButtonLink>
      </div>
    </article>
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
      ? { tone: "done", label: "Testnet", title: "Contracts deployed on X Layer testnet", body: "Chain 1952, test profile with mock tokens and a mock price feed." }
      : { tone: "pending", label: "Not deployed", title: "X Layer testnet deployment", body: "No Peridot contract is deployed on chain 1952 yet. The app shows clearly labelled example data and keeps writes disabled." },
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
          <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${toneClass[row.tone]}`}>{row.label}</span>
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
