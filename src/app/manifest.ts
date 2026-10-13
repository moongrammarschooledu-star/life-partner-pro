import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/public-site/config";

// Lets a phone or desktop browser install Life Partner Pro to the home screen. Installing adds an icon and a full-screen window; it does not
// make any private data available offline (see public/sw.js: only public static files are cached).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fdf1f4",
    theme_color: "#7a0f31",
    lang: "en",
    categories: ["lifestyle", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Create your profile", url: "/register" },
      { name: "Sign in", url: "/login" },
    ],
  };
}
