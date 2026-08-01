import "./globals.css";

export const metadata = {
  title: "SDR Electric — Inventory Ops",
  description: "Inventory tracking for electrical, plumbing & HVAC field work",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="f-body">{children}</body>
    </html>
  );
}
