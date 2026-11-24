import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "BetStats Pro | Inteligencia y valor en cuotas deportivas",
  description:
    "Análisis deportivo y valor esperado para fútbol, básquet, béisbol y hockey. Datos, clasificaciones, bajas y cuotas en un solo lugar.",
  applicationName: "BetStats Pro",
  keywords: [
    "apuestas deportivas",
    "análisis deportivo",
    "valor esperado",
    "fútbol",
    "NBA",
    "MLB",
    "NHL",
  ],
};

export const viewport: Viewport = {
  themeColor: "#05080f",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("betstats-theme");if(t==="light"){document.documentElement.classList.remove("dark");document.documentElement.style.colorScheme="light"}else{document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
