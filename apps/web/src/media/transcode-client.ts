/**
 * 服务端转码客户端。
 *
 * 浏览器解不了的素材（HEVC / 10bit / 4:2:2）在这里被送到服务器，
 * 用真 ffmpeg 转成 H.264 8bit 4:2:0，再取回来当普通 File 用 —— 后面
 * 的 OPFS 存储、缩略图、时间线、导出全都不需要知道发生过转码。
 */

export type TranscodeStatus =
	| "uploading"
	| "probing"
	| "running"
	| "done"
	| "error"
	| "cancelled";

export interface TranscodeJobView {
	id: string;
	name: string;
	status: TranscodeStatus;
	progress: number;
	speed: string | null;
	fps: number | null;
	outTimeMs: number;
	durationMs: number;
	sourceSize: number;
	outputSize: number;
	outputName: string | null;
	codec: string | null;
	profile: string | null;
	pixFmt: string | null;
	width: number | null;
	height: number | null;
	error: string | null;
	createdAt: number;
	finishedAt: number | null;
}

export interface TranscodeOptions {
	/** 目标高度；null = 保持原分辨率 */
	height: number | null;
	/** x264 CRF；默认 20 */
	crf: number;
}

export interface TranscodeProgress {
	stage: "uploading" | "server";
	uploadedBytes: number;
	totalBytes: number;
	/** 0-100，整体 */
	percent: number;
	speed: string | null;
	etaSeconds: number | null;
	job: TranscodeJobView | null;
}

const API = "/api/media/transcode";

export function isTranscodeAvailable(): boolean {
	// 服务存在即可，真正的能力探测交给 /api/media/stats 的 ffmpeg 字段
	return typeof window !== "undefined";
}

async function pollJob({
	id,
	signal,
	onProgress,
}: {
	id: string;
	signal?: AbortSignal;
	onProgress: (progress: TranscodeProgress) => void;
}): Promise<TranscodeJobView> {
	const startedAt = Date.now();

	for (;;) {
		if (signal?.aborted) throw new DOMException("已取消", "AbortError");

		const response = await fetch(`${API}?id=${encodeURIComponent(id)}`, {
			cache: "no-store",
			signal,
		});

		if (!response.ok) {
			throw new Error(`查询转码进度失败（HTTP ${response.status}）`);
		}

		const { job } = (await response.json()) as { job: TranscodeJobView };

		const elapsed = (Date.now() - startedAt) / 1000;
		const etaSeconds =
			job.status === "running" && job.progress > 0 && job.progress < 100
				? Math.max(0, (elapsed / job.progress) * (100 - job.progress))
				: null;

		onProgress({
			stage: "server",
			uploadedBytes: job.sourceSize,
			totalBytes: job.sourceSize,
			percent: job.status === "done" ? 100 : job.progress,
			speed: job.speed,
			etaSeconds,
			job,
		});

		if (job.status === "done") return job;
		if (job.status === "error") {
			throw new Error(job.error || "服务端转码失败");
		}
		if (job.status === "cancelled") {
			throw new DOMException("已取消", "AbortError");
		}

		await new Promise((resolve) => setTimeout(resolve, 700));
	}
}

function uploadFile({
	file,
	options,
	onProgress,
	signal,
}: {
	file: File;
	options: TranscodeOptions;
	onProgress: (progress: TranscodeProgress) => void;
	signal?: AbortSignal;
}): Promise<string> {
	return new Promise((resolve, reject) => {
		const query = new URLSearchParams({
			height: options.height === null ? "source" : String(options.height),
			crf: String(options.crf),
		});

		const xhr = new XMLHttpRequest();
		xhr.open("POST", `${API}?${query.toString()}`);
		xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
		xhr.setRequestHeader("content-type", "application/octet-stream");

		xhr.upload.addEventListener("progress", (event) => {
			if (!event.lengthComputable) return;
			onProgress({
				stage: "uploading",
				uploadedBytes: event.loaded,
				totalBytes: event.total,
				percent: Math.round((event.loaded / event.total) * 100),
				speed: null,
				etaSeconds: null,
				job: null,
			});
		});

		xhr.addEventListener("load", () => {
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(new Error(`上传失败（HTTP ${xhr.status}）`));
				return;
			}
			try {
				const parsed = JSON.parse(xhr.responseText) as { id?: string };
				if (!parsed.id) throw new Error("服务端没有返回任务 id");
				resolve(parsed.id);
			} catch (error) {
				reject(error instanceof Error ? error : new Error("响应解析失败"));
			}
		});

		xhr.addEventListener("error", () => reject(new Error("上传失败（网络）")));
		xhr.addEventListener("abort", () =>
			reject(new DOMException("已取消", "AbortError")),
		);

		signal?.addEventListener("abort", () => xhr.abort(), { once: true });

		xhr.send(file);
	});
}

export async function transcodeFile({
	file,
	options,
	onProgress,
	signal,
}: {
	file: File;
	options: TranscodeOptions;
	onProgress?: (progress: TranscodeProgress) => void;
	signal?: AbortSignal;
}): Promise<File> {
	const report = onProgress ?? (() => undefined);

	const id = await uploadFile({ file, options, onProgress: report, signal });
	const job = await pollJob({ id, signal, onProgress: report });

	const response = await fetch(`${API}?id=${encodeURIComponent(id)}&download=1`, {
		cache: "no-store",
		signal,
	});

	if (!response.ok) {
		throw new Error(`取回转码结果失败（HTTP ${response.status}）`);
	}

	const blob = await response.blob();
	const baseName = file.name.replace(/\.[^.]+$/, "");
	const outputName = job.outputName ?? `${baseName}_web.mp4`;

	return new File([blob], outputName, {
		type: "video/mp4",
		lastModified: Date.now(),
	});
}

export interface MediaStats {
	disk: {
		totalBytes: number;
		freeBytes: number;
		usedBytes: number;
		cacheBytes: number;
		cacheCount: number;
	};
	ffmpeg: string | null;
	jobs: TranscodeJobView[];
	cache: Array<{
		id: string;
		size: number;
		createdAt: number;
		name: string | null;
	}>;
}

export async function fetchMediaStats(): Promise<MediaStats> {
	const response = await fetch("/api/media/stats", { cache: "no-store" });
	if (!response.ok) throw new Error(`读取服务端状态失败（HTTP ${response.status}）`);
	return (await response.json()) as MediaStats;
}

export async function deleteCachedTranscode(id: string): Promise<void> {
	const response = await fetch(
		`/api/media/stats?id=${encodeURIComponent(id)}`,
		{ method: "DELETE" },
	);
	if (!response.ok) throw new Error(`删除失败（HTTP ${response.status}）`);
}

export function formatEta(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds)) return "—";
	if (seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`;
	const minutes = Math.floor(seconds / 60);
	const rest = Math.round(seconds % 60);
	if (minutes < 60) return `${minutes} 分 ${rest} 秒`;
	const hours = Math.floor(minutes / 60);
	return `${hours} 小时 ${minutes % 60} 分`;
}
