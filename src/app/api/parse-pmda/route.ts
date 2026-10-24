import { createPmdaPostHandler } from "@/lib/pmda-service";

export const runtime = "nodejs";
export const maxDuration = 30;
export const POST = createPmdaPostHandler();
