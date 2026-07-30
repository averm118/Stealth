import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 8080);
const compilerToken = process.env.COMPILER_TOKEN || "";
const maxBodyBytes = 220_000;
const compileTimeoutMs = 25_000;

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true, engine: "xelatex" });
    return;
  }

  if (request.method !== "POST" || request.url !== "/compile") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  if (compilerToken && request.headers.authorization !== `Bearer ${compilerToken}`) {
    sendJson(response, 401, { error: "Invalid compiler token." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    if (body.engine !== "xelatex" || typeof body.source !== "string" || !body.source.trim()) {
      sendJson(response, 400, { error: "A XeLaTeX source document is required." });
      return;
    }

    const pdf = await compile(body.source);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store"
    });
    response.end(pdf);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Compilation failed.";
    sendJson(response, 422, { error: message.slice(0, 1500) });
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Stealth LaTeX compiler listening on ${port}`);
});

async function compile(source) {
  const workDirectory = await mkdtemp(join(tmpdir(), "stealth-compiler-"));
  const texPath = join(workDirectory, "resume.tex");
  const pdfPath = join(workDirectory, "resume.pdf");

  try {
    await writeFile(texPath, source, "utf8");
    await execFileAsync(
      "xelatex",
      ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-output-directory", workDirectory, texPath],
      {
        cwd: workDirectory,
        timeout: compileTimeoutMs,
        maxBuffer: 1024 * 1024
      }
    );
    const pdf = await readFile(pdfPath);
    if (pdf.length < 800 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("XeLaTeX did not produce a valid PDF.");
    }
    return pdf;
  } catch (error) {
    const log =
      error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string"
        ? error.stdout.slice(-1200)
        : error instanceof Error
          ? error.message
          : "Unknown XeLaTeX error.";
    throw new Error(log);
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let received = 0;

  for await (const chunk of request) {
    received += chunk.length;
    if (received > maxBodyBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store"
  });
  response.end(body);
}
