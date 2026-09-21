import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BodyMaps CT Viewer",
  description:
    "Browser-based viewer for CT scans and per-voxel annotated structures (NIfTI). A 3D-Slicer-style tool that runs entirely client-side.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-mono antialiased">{children}</body>
    </html>
  );
}
