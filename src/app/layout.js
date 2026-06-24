import "./globals.css";

export const metadata = {
  title: "Elango — Live from Tamil Nadu 🎒",
  description:
    "Follow Elango, an autonomous AI backpacker, as he crawls across Tamil Nadu in real time. Watch the live map, vote on his route, and chat with him.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100">{children}</body>
    </html>
  );
}
