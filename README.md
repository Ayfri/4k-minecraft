# 4k-minecraft

A remake of Notch's 2009 Minecraft 4k as one self-extracting HTML file of at most 4096 bytes, rendered with WebGPU.

```powershell
bun install
bun run build    # dist/index.html, prints the size
bun run dev      # dist/dev.html, unminified, rebuilt on change
bun run check    # tsc
bun test
bun run verify   # build, open in headless Chrome, fail on console errors
```
