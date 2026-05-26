import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { createHash } from "node:crypto";
import { buildStructuredResumePromptText, structureResumeText } from "@/lib/resume-structure";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const maxResumeBytes = 8 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("resume");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a resume file." }, { status: 400 });
    }

    if (file.size > maxResumeBytes) {
      return NextResponse.json({ error: "Resume file must be under 8MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractTextFromResume(file, buffer);

    if (!text.trim()) {
      return NextResponse.json({ error: "No readable text was found in this resume." }, { status: 422 });
    }

    const structuredResume = structureResumeText(text);
    const textHash = createHash("sha256").update(text).digest("hex");
    const resumeDocument = await storeOriginalResumeDocument(file, buffer, textHash);
    const documentWarning =
      isDocx(file) && !resumeDocument
        ? "DOCX layout preservation is available in this browser for this upload. Supabase Storage did not store a server copy."
        : undefined;

    return NextResponse.json({
      fileName: file.name,
      fileType: file.type,
      sectionNames: structuredResume.sectionNames,
      resumeDocument,
      textHash,
      documentWarning,
      text: buildStructuredResumePromptText({
        fileName: file.name,
        fileType: file.type,
        structuredResume
      })
    });
  } catch (error) {
    const message = getSafeParseError(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function storeOriginalResumeDocument(file: File, buffer: Buffer, textHash: string) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const safeName = file.name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  const storagePath = `${user.id}/${Date.now()}-${safeName || "resume"}`;
  const { error } = await supabase.storage.from("resumes").upload(storagePath, buffer, {
    contentType: file.type || getFallbackMimeType(file.name),
    upsert: true
  });

  if (error) {
    console.warn("Could not store original resume document.", error);
    return null;
  }

  return {
    storagePath,
    fileName: file.name,
    fileType: file.type || getFallbackMimeType(file.name),
    fileSize: file.size,
    uploadedAt: new Date().toISOString(),
    textHash,
    exactLayoutSupported: isDocx(file)
  };
}

async function extractTextFromResume(file: File, buffer: Buffer) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractTextFromPdf(buffer);
  }

  if (
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return buffer.toString("utf-8");
  }

  throw new Error("Supported resume formats: PDF, DOCX, TXT, or MD.");
}

function isDocx(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function getFallbackMimeType(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

async function extractTextFromPdf(buffer: Buffer) {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText({
        lineEnforce: true,
        cellSeparator: "  ",
        pageJoiner: "\n\n--- PAGE page_number OF total_number ---\n\n"
      });
      if (result.text.trim()) return result.text;
    } finally {
      await parser.destroy();
    }
  } catch {
    throw new Error("Could not read this PDF. Try exporting it as a text-based PDF, DOCX, TXT, or MD.");
  }

  throw new Error("No readable text was found in this PDF. If it is scanned, export it as DOCX, TXT, or MD first.");
}

function getSafeParseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Object.defineProperty")) {
    return "Could not read this PDF. Try exporting it as text-based PDF, DOCX, TXT, or MD.";
  }

  return message || "Could not parse the uploaded resume.";
}
