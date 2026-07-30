import "server-only";

import { randomUUID } from "node:crypto";

const graphBaseUrl = "https://graph.microsoft.com/v1.0";
const graphScope = "https://graph.microsoft.com/.default";
const requestTimeoutMs = 45_000;
const conversionRetryStatuses = new Set([404, 409, 423, 429, 503]);

type GraphConfiguration = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  driveId: string;
  folderId: string;
};

type CachedAccessToken = {
  value: string;
  expiresAt: number;
};

let cachedAccessToken: CachedAccessToken | null = null;

export function isMicrosoftWordRendererConfigured() {
  return Boolean(getGraphConfiguration(false));
}

export async function renderDocxWithMicrosoftWord(docx: Buffer | Uint8Array) {
  const configuration = getGraphConfiguration(true);
  const accessToken = await getGraphAccessToken(configuration);
  const temporaryName = `${randomUUID()}.docx`;
  let itemId = "";
  let cleanupError: Error | null = null;

  try {
    itemId = await uploadTemporaryDocx(configuration, accessToken, temporaryName, docx);
    return await downloadConvertedPdf(configuration, accessToken, itemId);
  } finally {
    if (itemId) {
      try {
        await permanentlyDeleteTemporaryItem(configuration, accessToken, itemId);
      } catch {
        cleanupError = new Error("Microsoft Word rendered the resume, but temporary document cleanup failed.");
      }
    }

    if (cleanupError) throw cleanupError;
  }
}

function getGraphConfiguration(required: true): GraphConfiguration;
function getGraphConfiguration(required: false): GraphConfiguration | null;
function getGraphConfiguration(required: boolean): GraphConfiguration | null {
  const configuration: GraphConfiguration = {
    tenantId: process.env.MS_GRAPH_TENANT_ID?.trim() ?? "",
    clientId: process.env.MS_GRAPH_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.MS_GRAPH_CLIENT_SECRET?.trim() ?? "",
    driveId: process.env.MS_GRAPH_DRIVE_ID?.trim() ?? "",
    folderId: process.env.MS_GRAPH_FOLDER_ID?.trim() ?? ""
  };

  if (Object.values(configuration).every(Boolean)) return configuration;
  if (!required) return null;
  throw new Error(
    "Microsoft Word PDF rendering is not configured. Set MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_DRIVE_ID, and MS_GRAPH_FOLDER_ID."
  );
}

async function getGraphAccessToken(configuration: GraphConfiguration) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(configuration.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        grant_type: "client_credentials",
        scope: graphScope
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(`Microsoft Word renderer authentication failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Microsoft Word renderer returned an invalid access token.");
  }

  const expiresInSeconds =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) ? payload.expires_in : 3600;
  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(300, expiresInSeconds) * 1000
  };
  return payload.access_token;
}

async function uploadTemporaryDocx(
  configuration: GraphConfiguration,
  accessToken: string,
  temporaryName: string,
  docx: Buffer | Uint8Array
) {
  const uploadUrl =
    `${graphBaseUrl}/drives/${encodeURIComponent(configuration.driveId)}` +
    `/items/${encodeURIComponent(configuration.folderId)}:/${encodeURIComponent(temporaryName)}:/content`;
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    body: new Uint8Array(docx),
    signal: AbortSignal.timeout(requestTimeoutMs),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Microsoft Word renderer could not stage the resume (${response.status}).`);
  }

  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== "string" || !payload.id) {
    throw new Error("Microsoft Word renderer did not return a temporary document id.");
  }
  return payload.id;
}

async function downloadConvertedPdf(
  configuration: GraphConfiguration,
  accessToken: string,
  itemId: string
) {
  const convertUrl =
    `${graphBaseUrl}/drives/${encodeURIComponent(configuration.driveId)}` +
    `/items/${encodeURIComponent(itemId)}/content?format=pdf`;
  let lastStatus = 500;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(convertUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/pdf"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(requestTimeoutMs),
      cache: "no-store"
    });
    lastStatus = response.status;

    if (response.ok) {
      const pdf = Buffer.from(await response.arrayBuffer());
      assertPdf(pdf);
      return pdf;
    }

    if (!conversionRetryStatuses.has(response.status) || attempt === 3) break;
    await wait(400 * (attempt + 1));
  }

  throw new Error(`Microsoft Word could not convert the resume (${lastStatus}).`);
}

async function permanentlyDeleteTemporaryItem(
  configuration: GraphConfiguration,
  accessToken: string,
  itemId: string
) {
  const deleteUrl =
    `${graphBaseUrl}/drives/${encodeURIComponent(configuration.driveId)}` +
    `/items/${encodeURIComponent(itemId)}/permanentDelete`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(deleteUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(requestTimeoutMs),
      cache: "no-store"
    });
    if (response.ok || response.status === 404) return;
    if (attempt < 2) await wait(350 * (attempt + 1));
  }

  throw new Error("Temporary document cleanup failed.");
}

function assertPdf(value: Buffer) {
  if (value.byteLength < 5 || value.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Microsoft Word returned an invalid PDF.");
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
