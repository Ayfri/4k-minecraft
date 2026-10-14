# 4k-minecraft

A remake of Notch's 2009 Minecraft 4k as one self-extracting HTML file of at most 4096 bytes, rendered with WebGPU.

```powershell
bun install
bun run build         # dist/index.html, prints the size (--rank lists every minifier variant, --dev writes dist/dev.html)
bun run dev           # dev server with HMR on http://localhost:3000, unminified, DEV hooks on
bun run check         # tsc
bun test              # unit tests and the e2e render of dist/index.html, about 8 s
bun run test:fuzz     # packer fuzz, about a minute
bun run test:e2e      # build, then the e2e render alone
bun run verify        # build, open in headless Chrome from file://, fail on console errors, screenshot in the temp folder
bun scripts/webview.ts dist/dev.html --eval "dbg.bench()" --keys "w:500,space:100" --shot out.png
```
