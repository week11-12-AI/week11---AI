import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const types = { html: "text/html", css: "text/css", js: "text/javascript" };

export async function startServer(port = 4173) {
  const server = createServer(async (request, response) => {
    const requested = new URL(request.url, "http://127.0.0.1").pathname;
    const path = requested === "/" ? "/index.html" : requested;
    if (requested === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== "GET" || !/^\/(?:index\.html|styles\.css|(?:src|tests)\/[a-z-]+\.(?:html|js))$/.test(path)) {
      response.writeHead(404).end("Not found");
      return;
    }

    try {
      const file = await readFile(new URL(path.slice(1), root));
      const type = types[path.split(".").at(-1)];
      response.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store" });
      response.end(file);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Unable to serve the file");
    }
  });

  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", done);
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = await startServer(Number(process.env.PORT ?? 4173));
  console.log(`미니 React 실습: http://127.0.0.1:${server.address().port}`);
}
