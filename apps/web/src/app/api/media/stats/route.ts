import { deleteCache, diskStats, ffmpegVersion, listCache, listJobs } from "../_lib/transcode-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/media/stats
 *   → { disk, cache: [...], jobs: [...], ffmpeg }
 *
 * DELETE /api/media/stats?id=xxx
 *   → 删除一条转码缓存
 */

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export async function GET(): Promise<Response> {
	const [disk, cache, ffmpeg] = await Promise.all([
		diskStats(),
		listCache(),
		ffmpegVersion(),
	]);

	const cacheById = new Map(cache.map((item) => [item.id, item]));
	const jobs = listJobs().map((job) => ({
		...job,
		cachedBytes: cacheById.get(job.id)?.size ?? 0,
	}));

	const nameById = new Map(jobs.map((job) => [job.id, job]));

	return json({
		disk,
		ffmpeg,
		jobs,
		cache: cache.map((item) => ({
			...item,
			name: nameById.get(item.id)?.name ?? null,
		})),
	});
}

export async function DELETE(request: Request): Promise<Response> {
	const id = new URL(request.url).searchParams.get("id");
	if (!id) return json({ error: "缺少 id" }, 400);
	await deleteCache(id);
	return json({ ok: true });
}
