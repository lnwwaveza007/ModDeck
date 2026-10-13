import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design system · ModDeck",
};

// Specimen page for checking tokens on a real projector and on a phone outdoors.
// Open it from another device with `pnpm dev` (the dev server listens on 0.0.0.0).

const scales = {
  primary: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950],
  neutral: [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950],
  success: [50, 100, 500, 600, 700, 800],
  warning: [50, 100, 500, 600, 700, 800],
  error: [50, 100, 500, 600, 700, 800],
} as const;

// Tailwind only generates classes it can see as full strings, so list them.
const swatchClass: Record<string, string> = {
  "primary-50": "bg-primary-50",
  "primary-100": "bg-primary-100",
  "primary-200": "bg-primary-200",
  "primary-300": "bg-primary-300",
  "primary-400": "bg-primary-400",
  "primary-500": "bg-primary-500",
  "primary-600": "bg-primary-600",
  "primary-700": "bg-primary-700",
  "primary-800": "bg-primary-800",
  "primary-900": "bg-primary-900",
  "primary-950": "bg-primary-950",
  "neutral-0": "bg-neutral-0",
  "neutral-50": "bg-neutral-50",
  "neutral-100": "bg-neutral-100",
  "neutral-200": "bg-neutral-200",
  "neutral-300": "bg-neutral-300",
  "neutral-400": "bg-neutral-400",
  "neutral-500": "bg-neutral-500",
  "neutral-600": "bg-neutral-600",
  "neutral-700": "bg-neutral-700",
  "neutral-800": "bg-neutral-800",
  "neutral-900": "bg-neutral-900",
  "neutral-950": "bg-neutral-950",
  "success-50": "bg-success-50",
  "success-100": "bg-success-100",
  "success-500": "bg-success-500",
  "success-600": "bg-success-600",
  "success-700": "bg-success-700",
  "success-800": "bg-success-800",
  "warning-50": "bg-warning-50",
  "warning-100": "bg-warning-100",
  "warning-500": "bg-warning-500",
  "warning-600": "bg-warning-600",
  "warning-700": "bg-warning-700",
  "warning-800": "bg-warning-800",
  "error-50": "bg-error-50",
  "error-100": "bg-error-100",
  "error-500": "bg-error-500",
  "error-600": "bg-error-600",
  "error-700": "bg-error-700",
  "error-800": "bg-error-800",
};

const typeScale = [
  ["text-7xl font-bold", "482 914 · อันดับ 1"],
  ["text-6xl font-bold", "คำถามที่ 3: React ใช้ Virtual DOM ทำไม?"],
  ["text-4xl font-bold", "เด็คของฉัน · My decks"],
  ["text-3xl font-semibold", "ผลโหวต Poll แบบเรียลไทม์"],
  ["text-2xl font-semibold", "ถาม-ตอบ Q&A (12 คำถาม)"],
  ["text-xl font-semibold", "เข้าร่วมห้องเรียน Join session"],
  ["text-lg", "เลือกคำตอบที่ถูกต้อง แล้วกด Submit ก่อนหมดเวลา 30 วินาที"],
  ["text-base", "ผู้เข้าร่วม 87 คน ตอบแล้ว 64 คน (74%) — Wi-Fi หลุด ระบบจะเชื่อมต่อใหม่อัตโนมัติ"],
  ["text-sm", "ส่งเมื่อ 14:32 น. · แก้ไขได้ภายใน 5 นาที"],
  ["text-xs", "อัปเดตล่าสุด 2 วินาทีที่แล้ว · v1.0"],
  ["font-mono text-2xl font-semibold tracking-wider", "482 914"],
] as const;

const poll = [
  { option: "A · Python", pct: 46, votes: 40, bar: "bg-chart-1" },
  { option: "B · JavaScript", pct: 28, votes: 24, bar: "bg-chart-2" },
  { option: "C · Java", pct: 17, votes: 15, bar: "bg-chart-3" },
  { option: "D · C++", pct: 9, votes: 8, bar: "bg-chart-4" },
];

const button =
  "inline-flex h-12 items-center justify-center gap-2 rounded-md px-5 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 p-4 sm:p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold">ModDeck design system</h1>
        <p className="text-lg text-muted">
          ทดสอบบนโปรเจกเตอร์และมือถือกลางแจ้ง · Check this page on a real projector and on a phone
          in a bright room.
        </p>
      </header>

      <Section title="Color">
        {Object.entries(scales).map(([name, steps]) => (
          <div key={name} className="flex flex-col gap-2">
            <h3 className="text-base font-medium">{name}</h3>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
              {steps.map((step) => (
                <div key={step} className="flex flex-col gap-1">
                  <div
                    className={`h-12 rounded-md border border-border ${swatchClass[`${name}-${step}`]}`}
                  />
                  <span className="text-xs text-muted">{step}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Typography · IBM Plex Sans Thai">
        {typeScale.map(([cls, sample]) => (
          <div key={cls} className="flex flex-col gap-1 border-b border-border pb-4">
            <span className="text-xs text-muted">{cls}</span>
            <p className={cls}>{sample}</p>
          </div>
        ))}
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap gap-3">
          <button className={`${button} bg-primary-600 text-white hover:bg-primary-700`}>
            เริ่มเซสชัน Start
          </button>
          <button className={`${button} border border-border-strong bg-background text-foreground`}>
            ยกเลิก Cancel
          </button>
          <button className={`${button} text-primary-700`}>ข้าม Skip</button>
          <button className={`${button} border border-error-600 bg-background text-error-700`}>
            จบเซสชัน End
          </button>
          <button className={`${button} bg-neutral-100 text-neutral-400`} disabled>
            ปิดอยู่ Disabled
          </button>
        </div>
      </Section>

      <Section title="Input">
        <div className="grid gap-6 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">ชื่อเล่น Nickname</span>
            <input
              className="h-11 rounded-md border border-border-strong bg-background px-3 text-base placeholder:text-muted focus:border-2 focus:border-ring focus:outline-none focus:ring-3 focus:ring-primary-200"
              placeholder="เช่น มิ้นท์"
            />
            <span className="text-xs text-muted">แสดงบนจอโปรเจกเตอร์</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">รหัสห้อง Join code</span>
            <input
              aria-invalid
              className="h-11 rounded-md border-2 border-error-600 bg-background px-3 text-base focus:outline-none"
              defaultValue="48291"
            />
            <span className="text-xs text-error-700">⚠ รหัสต้องมี 6 หลัก</span>
          </label>
        </div>
      </Section>

      <Section title="Toggle + Badge">
        <div className="flex flex-wrap items-center gap-6">
          <span className="flex items-center gap-3">
            <span
              role="switch"
              aria-checked="true"
              className="flex h-6 w-11 justify-end rounded-full bg-primary-600 p-0.5"
            >
              <span className="size-5 rounded-full bg-white" />
            </span>
            ไม่ระบุชื่อ Anonymous
          </span>
          <span className="flex items-center gap-3">
            <span
              role="switch"
              aria-checked="false"
              className="flex h-6 w-11 rounded-full bg-neutral-500 p-0.5"
            >
              <span className="size-5 rounded-full bg-white" />
            </span>
            เปิด Q&amp;A
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-sm font-medium">
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-800">
            ร่าง Draft
          </span>
          <span className="rounded-full bg-primary-100 px-2 py-0.5 text-primary-800">
            กำลังสด Live
          </span>
          <span className="rounded-full bg-success-100 px-2 py-0.5 text-success-800">
            ✓ ถูกต้อง Correct
          </span>
          <span className="rounded-full bg-warning-100 px-2 py-0.5 text-warning-800">
            ! เชื่อมต่อใหม่ Reconnecting
          </span>
          <span className="rounded-full bg-error-100 px-2 py-0.5 text-error-800">
            ✕ หลุด Offline
          </span>
        </div>
      </Section>

      <Section title="Card + chart">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center gap-4">
            <h3 className="text-3xl font-semibold">ภาษาไหนเหมาะกับมือใหม่ที่สุด?</h3>
            <span className="rounded-full bg-success-100 px-2 py-0.5 text-sm font-medium text-success-800">
              ✓ ถูกต้อง Correct
            </span>
          </div>
          {poll.map((row) => (
            <div
              key={row.option}
              className="grid grid-cols-[8rem_1fr_5rem] items-center gap-4 sm:grid-cols-[12rem_1fr_6rem]"
            >
              <span className="text-lg">{row.option}</span>
              <div className="h-8 rounded-sm bg-neutral-100">
                <div className={`h-full rounded-sm ${row.bar}`} style={{ width: `${row.pct}%` }} />
              </div>
              <span className="text-right text-base font-medium">
                {row.pct}% · {row.votes}
              </span>
            </div>
          ))}
          <p className="text-base text-muted">ตอบแล้ว 87 จาก 92 คน · ✓ = คำตอบที่ถูก (A)</p>
        </div>
      </Section>
    </main>
  );
}
