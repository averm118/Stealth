# Stealth LaTeX Compiler

Private XeLaTeX compiler for apply-ready resume PDFs.

## Deploy

Deploy this directory as a Docker service on Railway, Render, Fly.io, or another private container host.

Set a long random `COMPILER_TOKEN` in the compiler service. Then configure the main Stealth deployment:

```bash
LATEX_COMPILER_URL=https://your-compiler.example.com/compile
LATEX_COMPILER_TOKEN=the-same-random-token
```

The service accepts only generated XeLaTeX source, disables shell escape, applies request and compile timeouts, and deletes each temporary build directory after responding.

## Local check

```bash
docker build -t stealth-latex-compiler .
docker run --rm -p 8080:8080 -e COMPILER_TOKEN=local-secret stealth-latex-compiler
curl http://localhost:8080/health
```
