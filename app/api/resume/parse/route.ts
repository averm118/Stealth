import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { buildStructuredResumePromptText, structureResumeText } from "@/lib/resume-structure";

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

    return NextResponse.json({
      fileName: file.name,
      fileType: file.type,
      sectionNames: structuredResume.sectionNames,
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
