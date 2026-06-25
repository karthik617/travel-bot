import "./globals.css";

export const metadata = {
  title: "Elango — Live from Tamil Nadu 🎒",
  description:
    "Follow Elango, an autonomous AI backpacker, as he crawls across Tamil Nadu in real time. Watch the live map, vote on his route, and chat with him.",
};

// Set the day/night theme from the live IST hour BEFORE first paint, so a
// night-time visitor never sees a flash of the light paper theme. Mirrors the
// threshold the React app uses (night = 19:00–05:59 IST).
const NO_FLASH_THEME = `(function(){try{
  var n=new Date();var ist=new Date(n.getTime()+n.getTimezoneOffset()*60000+5.5*3600000);
  var h=ist.getHours();
  document.documentElement.dataset.theme=(h<6||h>=19)?'night':'day';
}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
