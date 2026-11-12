import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import {
	cancelJob,
	createJob,
	deleteCache,
	getJob,
	listJobs,
	outputPathFor,
} from "../_lib/transcode-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/media/transcode?height=1080&crf=20
 *   body: 原始文件字节流
 *   header x-file-name: 文件名（encodeURIComponent）
 *   → { id }
 *
 * GET  /api/media/transcode            → { jobs: [...] }
 * GET  /api/media/transcode?id=xxx     → { job }
 * GET  /api/media/transcode?id=xxx&download=1 → 转码后的 mp4
 * DELETE /api/media/transcode?id=xxx   → 取消任务 + 删产物
 */

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export async function POST(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const rawName = request.headers.get("x-file-name") ?? "video.mp4";
	const name = decodeURIComponent(rawName);

	const heightParam = url.searchParams.get("height");
	const parsedHeight =
		heightParam === null || heightParam === "source"
			? null
			: Number.parseInt(heightParam, 10);
	const height =
		parsedHeight !== null && Number.isFinite(parsedHeight) && parsedHeight > 0
			? parsedHeight
			: null;

	const crfParam = Number.parseInt(url.searchParams.get("crf") ?? "20", 10);
	const crf = Number.isFinite(crfParam)
		? Math.min(30, Math.max(14, crfParam))
		: 20;

	if (!request.body) {
		return json({ error: "请求体为空，需要文件字节流" }, 400);
	}

	const job = await createJob({
		name,
		sourceSize: Number.parseInt(
			request.headers.get("content-length") ?? "0",
			10,
		),
		body: request.body,
		options: { height, crf },
	});

	return json({ id: job.id, job });
}

export async function GET(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const id = url.searchParams.get("id");

	if (!id) {
		return json({ jobs: listJobs() });
	}

	const job = getJob(id);

	if (url.searchParams.get("download") === "1") {
		const filePath = outputPathFor(id);
		let size = 0;
		try {
			const info = await stat(filePath);
			size = info.size;
		} catch {
			return json({ error: "转码产物不存在（可能已清理或尚未完成）" }, 404);
		}

		const stream = Readable.toWeb(createReadStream(filePath));
		return new Response(stream as unknown as ReadableStream, {
			headers: {
				"content-type": "video/mp4",
				"content-length": String(size),
				"content-disposition": `attachment; filename="${encodeURIComponent(
					job?.outputName ?? `${id}.mp4`,
				)}"`,
				"cache-control": "no-store",
			},
		});
	}

	if (!job) return json({ error: "任务不存在" }, 404);
	return json({ job });
}

export async function DELETE(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const id = url.searchParams.get("id");
	if (!id) return json({ error: "缺少 id" }, 400);

	const cancelled = cancelJob(id);
	await deleteCache(id);

	return json({ ok: true, cancelled });
}
