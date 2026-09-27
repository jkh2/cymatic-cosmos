// Builds the instrument as one self-contained index.html, like the original,
// so it can be opened from GitHub Pages with no server.
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  plugins: [tailwindcss(), viteReact(), viteSingleFile()],
  build: { outDir: "../dist-standalone", emptyOutDir: true },
});
