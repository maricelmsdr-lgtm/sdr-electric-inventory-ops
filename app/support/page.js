export const metadata = {
  title: "Support | SDR Electric - Inventory Ops",
  description: "Support for SDR Electric - Inventory Ops",
};

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6 py-16">
      <div className="max-w-3xl w-full bg-slate-900 rounded-2xl border border-slate-800 shadow-xl p-10">
        <h1 className="text-4xl font-bold text-orange-500 mb-4">
          SDR Electric – Inventory Ops
        </h1>

        <p className="text-slate-300 leading-7">
          Welcome to the official support page for
          <strong> SDR Electric – Inventory Ops</strong>.
        </p>

        <p className="mt-6 text-slate-300 leading-7">
          Inventory Ops is a cloud-based inventory and warehouse management
          platform built for service businesses to manage inventory, warehouses,
          purchasing, fleet inventory, field requests, and reporting.
        </p>

        <div className="mt-10">
          <h2 className="text-2xl font-semibold text-orange-400 mb-3">
            Contact Support
          </h2>

          <p className="text-slate-300">
            For application or ServiceM8 support:
          </p>

          <a
            href="mailto:mallari2312@gmail.com"
            className="inline-block mt-4 text-sky-400 hover:text-sky-300"
          >
            📧 mallari2312@gmail.com
          </a>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-700 text-sm text-slate-500">
          © 2026 SDR Electric. All rights reserved.
        </div>
      </div>
    </main>
  );
}