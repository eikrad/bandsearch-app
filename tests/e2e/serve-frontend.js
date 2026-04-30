const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const DIST = path.resolve(__dirname, "../../apps/desktop/dist");
const PORT = 4000;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
};

http.createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : req.url.slice(1);
  const filePath = path.join(DIST, file);
  const ext = path.extname(filePath);
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log(`frontend on http://localhost:${PORT}`));
