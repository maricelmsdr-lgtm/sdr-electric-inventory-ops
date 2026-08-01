export default function SupportPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#070a14",
        color: "#e2e8f0",
        padding: "24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 500,
          width: "100%",
          background: "#111827",
          borderRadius: 16,
          padding: 40,
          textAlign: "center",
          boxShadow: "0 15px 40px rgba(0,0,0,.35)",
        }}
      >
        <div
          style={{
            width: 70,
            height: 70,
            margin: "0 auto 20px",
            background: "#f97316",
            borderRadius: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 34,
          }}
        >
          ⚡
        </div>

        <h1>SDR Electric — Inventory Ops</h1>

        <p
          style={{
            color: "#94a3b8",
            lineHeight: 1.7,
          }}
        >
          Support for the SDR Electric ServiceM8 Integration.
        </p>

        <p>
          Need assistance?
          <br />
          Contact us anytime.
        </p>

        <a
          href="mailto:mallari2312@gmail.com"
          style={{
            color: "#f97316",
            fontWeight: "bold",
            textDecoration: "none",
          }}
        >
          mallari2312@gmail.com
        </a>

        <hr
          style={{
            margin: "30px 0",
            borderColor: "#1f2937",
          }}
        />

        <p
          style={{
            color: "#64748b",
            fontSize: 14,
          }}
        >
          © 2026 SDR Electric
        </p>
      </div>
    </main>
  );
}