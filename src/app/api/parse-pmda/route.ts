import { NextRequest, NextResponse } from "next/server";
import { parsePmdaZip } from "@/lib/pmda-parser";

const ALLOWED_HOST = "www.pmda.go.jp";
const ALLOWED_PATH_PREFIX = "/PmdaSearch/iyakuDetail/ResultDataSetXML/";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { url?: unknown };
    const url = validatePmdaUrl(body.url);

    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        "User-Agent": "pmda-pk-viewer/0.1 educational parser",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `PMDAから取得できませんでした: HTTP ${response.status}` },
        { status: 502 },
      );
    }

    const result = parsePmdaZip(await response.arrayBuffer(), url.toString());
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "解析中にエラーが発生しました。" },
      { status: 400 },
    );
  }
}

function validatePmdaUrl(value: unknown): URL {
  if (typeof value !== "string") {
    throw new Error("PMDA XML URLを入力してください。");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URLの形式が正しくありません。");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== ALLOWED_HOST ||
    !url.pathname.startsWith(ALLOWED_PATH_PREFIX)
  ) {
    throw new Error(
      `許可されているのは https://${ALLOWED_HOST}${ALLOWED_PATH_PREFIX} から始まるURLだけです。`,
    );
  }

  return url;
}
